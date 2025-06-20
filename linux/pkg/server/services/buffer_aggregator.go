package services

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// BufferAggregatorConfig holds configuration for BufferAggregator
type BufferAggregatorConfig struct {
	TerminalManager *TerminalManager
	RemoteRegistry  *RemoteRegistry
	IsHQMode        bool
}

// BufferAggregator manages WebSocket connections and buffer distribution
type BufferAggregator struct {
	config             *BufferAggregatorConfig
	clientSubscriptions map[*websocket.Conn]map[string]func() // conn -> sessionID -> unsubscribe func
	remoteConnections  map[string]*RemoteWebSocketConnection
	mu                 sync.RWMutex
	upgrader           websocket.Upgrader
}

// RemoteWebSocketConnection represents a connection to a remote server
type RemoteWebSocketConnection struct {
	WS            *websocket.Conn
	RemoteID      string
	RemoteName    string
	Subscriptions map[string]bool
}

// NewBufferAggregator creates a new buffer aggregator service
func NewBufferAggregator(config *BufferAggregatorConfig) *BufferAggregator {
	return &BufferAggregator{
		config:              config,
		clientSubscriptions: make(map[*websocket.Conn]map[string]func()),
		remoteConnections:   make(map[string]*RemoteWebSocketConnection),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins
			},
		},
	}
}

// HandleClientConnection handles a new WebSocket client connection
func (ba *BufferAggregator) HandleClientConnection(w http.ResponseWriter, r *http.Request) {
	conn, err := ba.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[BufferAggregator] Failed to upgrade connection: %v", err)
		return
	}

	log.Printf("[BufferAggregator] New client connected")

	// Initialize subscription map for this client
	ba.mu.Lock()
	ba.clientSubscriptions[conn] = make(map[string]func())
	ba.mu.Unlock()

	// Send welcome message
	conn.WriteJSON(map[string]interface{}{
		"type":    "connected",
		"version": "1.0",
	})

	// Handle messages from client
	go ba.handleClientMessages(conn)
}

// handleClientMessages handles incoming messages from a client
func (ba *BufferAggregator) handleClientMessages(conn *websocket.Conn) {
	defer func() {
		ba.handleClientDisconnect(conn)
		conn.Close()
	}()

	for {
		var msg map[string]interface{}
		if err := conn.ReadJSON(&msg); err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[BufferAggregator] WebSocket error: %v", err)
			}
			break
		}

		msgType, _ := msg["type"].(string)
		sessionID, _ := msg["sessionId"].(string)

		switch msgType {
		case "subscribe":
			if sessionID != "" {
				ba.handleSubscribe(conn, sessionID)
			}

		case "unsubscribe":
			if sessionID != "" {
				ba.handleUnsubscribe(conn, sessionID)
			}

		case "ping":
			conn.WriteJSON(map[string]interface{}{
				"type":      "pong",
				"timestamp": time.Now().UnixMilli(),
			})
		}
	}
}

// handleSubscribe handles subscription requests
func (ba *BufferAggregator) handleSubscribe(conn *websocket.Conn, sessionID string) {
	ba.mu.Lock()
	subscriptions := ba.clientSubscriptions[conn]
	ba.mu.Unlock()

	if subscriptions == nil {
		return
	}

	// Unsubscribe from existing subscription if any
	if unsubscribe, exists := subscriptions[sessionID]; exists && unsubscribe != nil {
		unsubscribe()
		delete(subscriptions, sessionID)
	}

	// Check if this is a remote session
	var isRemoteSession *RemoteServer
	if ba.config.IsHQMode && ba.config.RemoteRegistry != nil {
		isRemoteSession = ba.config.RemoteRegistry.GetRemoteBySessionID(sessionID)
	}

	if isRemoteSession != nil {
		// Subscribe to remote session
		ba.subscribeToRemoteSession(conn, sessionID, isRemoteSession.ID)
	} else {
		// Subscribe to local session
		ba.subscribeToLocalSession(conn, sessionID)
	}

	conn.WriteJSON(map[string]interface{}{
		"type":      "subscribed",
		"sessionId": sessionID,
	})

	log.Printf("[BufferAggregator] Client subscribed to session %s", sessionID)
}

// subscribeToLocalSession subscribes a client to a local session
func (ba *BufferAggregator) subscribeToLocalSession(conn *websocket.Conn, sessionID string) {
	// Subscribe to buffer changes
	unsubscribe := ba.config.TerminalManager.SubscribeToBufferChanges(sessionID, func(data []byte) {
		// Send buffer update to client
		ba.sendBufferToClient(conn, sessionID, data)
	})

	ba.mu.Lock()
	if subscriptions, ok := ba.clientSubscriptions[conn]; ok {
		subscriptions[sessionID] = unsubscribe
	}
	ba.mu.Unlock()

	// Send initial buffer
	if buffer, err := ba.config.TerminalManager.GetBufferSnapshot(sessionID); err == nil {
		ba.sendBufferToClient(conn, sessionID, buffer)
	}
}

// subscribeToRemoteSession subscribes a client to a remote session
func (ba *BufferAggregator) subscribeToRemoteSession(conn *websocket.Conn, sessionID, remoteID string) {
	// Ensure we have a connection to this remote
	remoteConn := ba.ensureRemoteConnection(remoteID)
	if remoteConn == nil {
		conn.WriteJSON(map[string]interface{}{
			"type":    "error",
			"message": "Failed to connect to remote server",
		})
		return
	}

	// Subscribe to the session on the remote
	remoteConn.Subscriptions[sessionID] = true
	remoteConn.WS.WriteJSON(map[string]interface{}{
		"type":      "subscribe",
		"sessionId": sessionID,
	})

	// Store an unsubscribe function
	ba.mu.Lock()
	if subscriptions, ok := ba.clientSubscriptions[conn]; ok {
		subscriptions[sessionID] = func() {
			// Will be handled in unsubscribe
		}
	}
	ba.mu.Unlock()
}

// ensureRemoteConnection ensures we have a WebSocket connection to a remote server
func (ba *BufferAggregator) ensureRemoteConnection(remoteID string) *RemoteWebSocketConnection {
	ba.mu.RLock()
	remoteConn := ba.remoteConnections[remoteID]
	ba.mu.RUnlock()

	if remoteConn != nil && remoteConn.WS != nil {
		return remoteConn
	}

	// Need to connect
	remote := ba.config.RemoteRegistry.GetRemote(remoteID)
	if remote == nil {
		return nil
	}

	// Create WebSocket URL from HTTP URL
	wsURL := remote.URL
	if len(wsURL) > 4 && wsURL[:4] == "http" {
		wsURL = "ws" + wsURL[4:]
	}

	// Connect with Bearer auth
	header := http.Header{}
	header.Set("Authorization", "Bearer "+remote.Token)

	dialer := websocket.Dialer{
		HandshakeTimeout: 5 * time.Second,
	}

	ws, _, err := dialer.Dial(wsURL, header)
	if err != nil {
		log.Printf("[BufferAggregator] Failed to connect to remote %s: %v", remote.Name, err)
		return nil
	}

	remoteConn = &RemoteWebSocketConnection{
		WS:            ws,
		RemoteID:      remote.ID,
		RemoteName:    remote.Name,
		Subscriptions: make(map[string]bool),
	}

	ba.mu.Lock()
	ba.remoteConnections[remoteID] = remoteConn
	ba.mu.Unlock()

	// Handle messages from remote
	go ba.handleRemoteMessages(remoteConn)

	log.Printf("[BufferAggregator] Connected to remote %s", remote.Name)
	return remoteConn
}

// handleRemoteMessages handles messages from a remote server
func (ba *BufferAggregator) handleRemoteMessages(remoteConn *RemoteWebSocketConnection) {
	defer func() {
		ba.mu.Lock()
		delete(ba.remoteConnections, remoteConn.RemoteID)
		ba.mu.Unlock()
		remoteConn.WS.Close()
	}()

	for {
		messageType, data, err := remoteConn.WS.ReadMessage()
		if err != nil {
			log.Printf("[BufferAggregator] Remote %s disconnected: %v", remoteConn.RemoteName, err)
			break
		}

		if messageType == websocket.BinaryMessage && len(data) > 0 && data[0] == 0xbf {
			// Binary buffer update - forward to subscribed clients
			ba.forwardBufferToClients(data)
		} else if messageType == websocket.TextMessage {
			// JSON message
			var msg map[string]interface{}
			if err := json.Unmarshal(data, &msg); err == nil {
				log.Printf("[BufferAggregator] Remote %s message: %v", remoteConn.RemoteName, msg["type"])
			}
		}
	}
}

// sendBufferToClient sends a buffer update to a specific client
func (ba *BufferAggregator) sendBufferToClient(conn *websocket.Conn, sessionID string, buffer []byte) {
	// Create binary message with session ID
	sessionIDBytes := []byte(sessionID)
	totalLen := 1 + 4 + len(sessionIDBytes) + len(buffer)
	fullBuffer := make([]byte, totalLen)

	offset := 0
	fullBuffer[offset] = 0xbf // Magic byte
	offset++

	// Session ID length (little-endian)
	fullBuffer[offset] = byte(len(sessionIDBytes))
	fullBuffer[offset+1] = byte(len(sessionIDBytes) >> 8)
	fullBuffer[offset+2] = byte(len(sessionIDBytes) >> 16)
	fullBuffer[offset+3] = byte(len(sessionIDBytes) >> 24)
	offset += 4

	// Session ID
	copy(fullBuffer[offset:], sessionIDBytes)
	offset += len(sessionIDBytes)

	// Buffer data
	copy(fullBuffer[offset:], buffer)

	conn.WriteMessage(websocket.BinaryMessage, fullBuffer)
}

// forwardBufferToClients forwards a buffer update from a remote to subscribed clients
func (ba *BufferAggregator) forwardBufferToClients(data []byte) {
	// Extract session ID from buffer
	if len(data) < 5 {
		return
	}

	sessionIDLen := int(data[1]) | int(data[2])<<8 | int(data[3])<<16 | int(data[4])<<24
	if len(data) < 5+sessionIDLen {
		return
	}

	sessionID := string(data[5 : 5+sessionIDLen])

	// Forward to all clients subscribed to this session
	ba.mu.RLock()
	defer ba.mu.RUnlock()

	for conn, subscriptions := range ba.clientSubscriptions {
		if _, subscribed := subscriptions[sessionID]; subscribed {
			conn.WriteMessage(websocket.BinaryMessage, data)
		}
	}
}

// handleUnsubscribe handles unsubscribe requests
func (ba *BufferAggregator) handleUnsubscribe(conn *websocket.Conn, sessionID string) {
	ba.mu.Lock()
	subscriptions := ba.clientSubscriptions[conn]
	ba.mu.Unlock()

	if subscriptions == nil {
		return
	}

	if unsubscribe, exists := subscriptions[sessionID]; exists && unsubscribe != nil {
		unsubscribe()
		delete(subscriptions, sessionID)
	}

	// Also unsubscribe from remote if applicable
	if ba.config.IsHQMode && ba.config.RemoteRegistry != nil {
		remote := ba.config.RemoteRegistry.GetRemoteBySessionID(sessionID)
		if remote != nil {
			ba.mu.RLock()
			remoteConn := ba.remoteConnections[remote.ID]
			ba.mu.RUnlock()

			if remoteConn != nil {
				delete(remoteConn.Subscriptions, sessionID)
				remoteConn.WS.WriteJSON(map[string]interface{}{
					"type":      "unsubscribe",
					"sessionId": sessionID,
				})
			}
		}
	}

	log.Printf("[BufferAggregator] Client unsubscribed from session %s", sessionID)
}

// handleClientDisconnect handles client disconnection
func (ba *BufferAggregator) handleClientDisconnect(conn *websocket.Conn) {
	ba.mu.Lock()
	subscriptions := ba.clientSubscriptions[conn]
	delete(ba.clientSubscriptions, conn)
	ba.mu.Unlock()

	// Unsubscribe from all sessions
	for _, unsubscribe := range subscriptions {
		if unsubscribe != nil {
			unsubscribe()
		}
	}

	log.Printf("[BufferAggregator] Client disconnected")
}

// Stop gracefully stops the buffer aggregator
func (ba *BufferAggregator) Stop() {
	// Close all client connections
	ba.mu.Lock()
	for conn := range ba.clientSubscriptions {
		conn.Close()
	}
	ba.clientSubscriptions = make(map[*websocket.Conn]map[string]func())

	// Close all remote connections
	for _, remoteConn := range ba.remoteConnections {
		remoteConn.WS.Close()
	}
	ba.remoteConnections = make(map[string]*RemoteWebSocketConnection)
	ba.mu.Unlock()
}