#!/bin/bash

# Define the virtual environment directory
VENV_DIR="./venv"

# Check if the virtual environment exists, if not create it
if [ ! -d "$VENV_DIR" ]; then
    echo "No virtual environment found. Creating one..."
    python3 -m venv "$VENV_DIR"
    
    if [ $? -ne 0 ]; then
        echo "Failed to create virtual environment."
        exit 1
    fi
fi

# Activate the virtual environment
echo "Activating the virtual environment..."
source "$VENV_DIR/bin/activate" || source "$VENV_DIR/Scripts/activate"

# Upgrade pip to avoid dependency issues
echo "Upgrading pip..."
pip install --upgrade pip

# Check if Blinka is installed
if ! python -c "import board" &> /dev/null; then
    echo "Blinka not found. Installing..."
    pip install Adafruit-Blinka
else
    echo "Blinka is already installed."
fi

# Run the Python script
echo "Running 12c_display.py..."
python 12c_display.py
