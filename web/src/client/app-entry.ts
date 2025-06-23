// Entry point for the app
import { initializeMonaco } from './utils/monaco-loader.js';
import './app.js';

// Initialize Monaco Editor on startup
initializeMonaco().catch(console.error);
