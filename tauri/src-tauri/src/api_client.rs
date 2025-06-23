use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct ApiClient {
    client: Client,
    base_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateSessionRequest {
    pub name: Option<String>,
    pub rows: Option<u16>,
    pub cols: Option<u16>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub shell: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionResponse {
    pub id: String,
    pub name: String,
    pub pid: u32,
    pub rows: u16,
    pub cols: u16,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InputRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResizeRequest {
    pub cols: u16,
    pub rows: u16,
}

impl ApiClient {
    pub fn new(port: u16) -> Self {
        Self {
            client: Client::new(),
            base_url: format!("http://127.0.0.1:{}", port),
        }
    }

    pub async fn create_session(&self, req: CreateSessionRequest) -> Result<SessionResponse, String> {
        let url = format!("{}/api/sessions", self.base_url);
        
        let response = self.client
            .post(&url)
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("Failed to create session: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Server returned error {}: {}", status, error_text));
        }

        response
            .json::<SessionResponse>()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))
    }

    pub async fn list_sessions(&self) -> Result<Vec<SessionResponse>, String> {
        let url = format!("{}/api/sessions", self.base_url);
        
        let response = self.client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to list sessions: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Server returned error {}: {}", status, error_text));
        }

        response
            .json::<Vec<SessionResponse>>()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))
    }

    pub async fn close_session(&self, id: &str) -> Result<(), String> {
        let url = format!("{}/api/sessions/{}", self.base_url, id);
        
        let response = self.client
            .delete(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to close session: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Server returned error {}: {}", status, error_text));
        }

        Ok(())
    }

    pub async fn send_input(&self, id: &str, input: &[u8]) -> Result<(), String> {
        let url = format!("{}/api/sessions/{}/input", self.base_url, id);
        
        // Convert bytes to string
        let text = String::from_utf8_lossy(input).into_owned();
        let req = InputRequest { 
            text: Some(text),
            key: None,
        };
        
        let response = self.client
            .post(&url)
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("Failed to send input: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Server returned error {}: {}", status, error_text));
        }

        Ok(())
    }

    pub async fn resize_session(&self, id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let url = format!("{}/api/sessions/{}/resize", self.base_url, id);
        
        let req = ResizeRequest { cols, rows };
        
        let response = self.client
            .post(&url)
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("Failed to resize session: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Server returned error {}: {}", status, error_text));
        }

        Ok(())
    }

    pub async fn get_session_output(&self, id: &str) -> Result<Vec<u8>, String> {
        let url = format!("{}/api/sessions/{}/buffer", self.base_url, id);
        
        let response = self.client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to get session output: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Server returned error {}: {}", status, error_text));
        }

        response
            .bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| format!("Failed to read response: {}", e))
    }
}