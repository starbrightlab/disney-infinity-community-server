#!/bin/bash

# Disney Infinity Community Server - Linux/macOS Setup Script
# This script helps configure Linux and macOS clients to use the community server

echo "Disney Infinity Community Server Setup"
echo "======================================"
echo

# Check if running as root/sudo
if [[ $EUID -eq 0 ]]; then
    SUDO=""
    HOSTS_FILE="/etc/hosts"
else
    SUDO="sudo"
    HOSTS_FILE="/etc/hosts"
fi

# Get server address
read -p "Enter your community server IP or domain: " SERVER_IP
if [ -z "$SERVER_IP" ]; then
    echo "Error: Server address is required"
    exit 1
fi

echo
echo "Configuring hosts file..."
echo

# Backup original hosts file
$SUDO cp "$HOSTS_FILE" "${HOSTS_FILE}.backup" 2>/dev/null

# Add community server entries
$SUDO tee -a "$HOSTS_FILE" > /dev/null << EOF

# Disney Infinity Community Server
$SERVER_IP disney.go.com
$SERVER_IP toys.disney.go.com
$SERVER_IP ugc.disney.go.com
$SERVER_IP api.toybox.com
EOF

echo
echo "Testing connection to server..."
echo

ping -c 1 -W 2 "$SERVER_IP" >/dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "Warning: Cannot ping server. Please check the address and firewall settings."
else
    echo "Server connection successful."
fi

echo
echo "Testing API endpoint..."
echo

curl -s --max-time 5 "http://$SERVER_IP/api/v1/health" >/dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "Warning: Cannot reach API endpoint. Please check server configuration."
else
    echo "API endpoint reachable."
fi

echo
echo "Setup complete!"
echo
echo "What was configured:"
echo "- Added server entries to hosts file ($HOSTS_FILE)"
echo "- Created backup of original hosts file (${HOSTS_FILE}.backup)"
echo
echo "To revert changes, run: $SUDO cp ${HOSTS_FILE}.backup $HOSTS_FILE"
echo
echo "You can now launch Disney Infinity 3.0 Gold and use community UGC features."
echo

# Detect platform and give additional instructions
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "macOS detected. You may need to flush DNS cache:"
    echo "  sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder"
    echo
fi
