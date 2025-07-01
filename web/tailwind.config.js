/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./src/**/*.{html,js,ts,jsx,tsx}", "./src/**/*.ts", "./src/components/*.ts", "./src/*.ts", "./public/**/*.html"],
    theme: {
        extend: {
            colors: {
                // Enhanced Dark theme colors with better depth
                "dark-bg": "#0a0a0a",
                "dark-bg-secondary": "#141414",
                "dark-bg-tertiary": "#1f1f1f",
                "dark-bg-elevated": "#262626",
                "dark-surface": "#1a1a1a",
                "dark-surface-hover": "#2a2a2a",
                "dark-border": "#2a2a2a",
                "dark-border-light": "#3a3a3a",
                "dark-border-focus": "#4a4a4a",
                
                // Enhanced Text colors
                "dark-text": "#e4e4e4",
                "dark-text-bright": "#ffffff",
                "dark-text-muted": "#888888",
                "dark-text-dim": "#666666",
                
                // Modern accent colors - Cyan/Teal primary
                "accent-primary": "#00D9FF",
                "accent-primary-dark": "#00B8E6",
                "accent-primary-darker": "#0096CC",
                "accent-primary-light": "#33E1FF",
                "accent-primary-glow": "#00D9FF66",
                
                // Green accent colors (success/active)
                "accent-green": "#4ADE80",
                "accent-green-dark": "#22C55E",
                "accent-green-darker": "#16A34A",
                "accent-green-light": "#86EFAC",
                "accent-green-glow": "#4ADE8066",
                
                // Secondary accent colors
                "accent-purple": "#A78BFA",
                "accent-blue": "#60A5FA",
                "accent-amber": "#FFA726",
                
                // Enhanced Status colors
                "status-error": "#FF6B6B",
                "status-warning": "#FFA726",
                "status-success": "#4ADE80",
                "status-info": "#60A5FA",
                
                // Legacy VS Code theme colors (for compatibility)
                "vs-bg": "#0a0a0a",
                "vs-text": "#e4e4e4",
                "vs-muted": "#7a7a7a",
                "vs-accent": "#00ff88",
                "vs-user": "#00ff88",
                "vs-assistant": "#00ccaa",
                "vs-warning": "#ffaa44",
                "vs-function": "#44ffaa",
                "vs-type": "#00ffcc",
                "vs-border": "#2a2a2a",
                "vs-border-light": "#3a3a3a",
                "vs-bg-secondary": "#1a1a1a",
                "vs-nav": "#1a1a1a",
                "vs-nav-hover": "#242424",
                "vs-nav-active": "#00ff88",
                "vs-highlight": "#8b6914",
            },
            boxShadow: {
                // Updated glow effects with new colors
                'glow-primary': '0 0 20px rgba(0, 217, 255, 0.4)',
                'glow-primary-sm': '0 0 10px rgba(0, 217, 255, 0.3)',
                'glow-primary-lg': '0 0 30px rgba(0, 217, 255, 0.5)',
                'glow-green': '0 0 20px rgba(74, 222, 128, 0.4)',
                'glow-green-sm': '0 0 10px rgba(74, 222, 128, 0.3)',
                'glow-green-lg': '0 0 30px rgba(74, 222, 128, 0.5)',
                // New subtle shadows
                'card': '0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.4)',
                'card-hover': '0 4px 6px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.4)',
                'elevated': '0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.2)',
            },
            animation: {
                'pulse-green': 'pulseGreen 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'pulse-primary': 'pulsePrimary 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'slide-in-right': 'slideInRight 0.3s ease-out',
                'slide-in-bottom': 'slideInBottom 0.3s ease-out',
                'fade-in': 'fadeIn 0.2s ease-out',
                'scale-in': 'scaleIn 0.2s ease-out',
            },
            keyframes: {
                pulseGreen: {
                    '0%, 100%': {
                        opacity: '1',
                    },
                    '50%': {
                        opacity: '.8',
                    },
                },
                pulsePrimary: {
                    '0%, 100%': {
                        opacity: '1',
                    },
                    '50%': {
                        opacity: '.7',
                    },
                },
                slideInRight: {
                    '0%': {
                        transform: 'translateX(100%)',
                        opacity: '0',
                    },
                    '100%': {
                        transform: 'translateX(0)',
                        opacity: '1',
                    },
                },
                slideInBottom: {
                    '0%': {
                        transform: 'translateY(100%)',
                        opacity: '0',
                    },
                    '100%': {
                        transform: 'translateY(0)',
                        opacity: '1',
                    },
                },
                fadeIn: {
                    '0%': {
                        opacity: '0',
                    },
                    '100%': {
                        opacity: '1',
                    },
                },
                scaleIn: {
                    '0%': {
                        transform: 'scale(0.95)',
                        opacity: '0',
                    },
                    '100%': {
                        transform: 'scale(1)',
                        opacity: '1',
                    },
                },
            },
        },
    },
    plugins: [],
};