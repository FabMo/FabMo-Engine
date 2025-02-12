import board
import busio

I2C_ADDR = 0x3C  # Default I2C address for SSD1309
_COMMAND_MODE = 0x00  # Command mode identifier
_DATA_MODE = 0x40  # Data mode identifier

class SSD1309:
    def __init__(self, i2c):
        self.i2c = i2c
        self._init_display()

    def _write_command(self, cmd):
        self.i2c.writeto(I2C_ADDR, bytes([_COMMAND_MODE, cmd]))

    def _write_data(self, data):
        self.i2c.writeto(I2C_ADDR, bytes([_DATA_MODE, data]))

    def _init_display(self):
        # Initialization sequence based on the SSD1309 datasheet
        self._write_command(0xAE)  # Display OFF
        self._write_command(0xA8)  # Set Multiplex Ratio
        self._write_command(0x3F)  # 1/64 duty (0x3F)
        self._write_command(0xD3)  # Set Display Offset
        self._write_command(0x00)  # No offset
        self._write_command(0x40)  # Set Display Start Line to 0
        self._write_command(0xA1)  # Set Segment Re-map to 0xA1
        self._write_command(0xC8)  # Set COM Output Scan Direction (0xC8 for reverse)
        self._write_command(0xDA)  # Set COM Pins hardware configuration
        self._write_command(0x12)  # Alternative COM pin config
        self._write_command(0x81)  # Set Contrast Control
        self._write_command(0x7F)  # Contrast to 0x7F
        self._write_command(0xD5)  # Set Display Clock Divide Ratio/ Oscillator Frequency
        self._write_command(0x80)  # Default divide ratio
        self._write_command(0xD9)  # Set Pre-charge Period
        self._write_command(0xF1)  # Pre-charge period
        self._write_command(0xDB)  # Set VCOMH Deselect Level
        self._write_command(0x40)  # VCOMH deselect level
        self._write_command(0xA4)  # Resume to RAM content display
        self._write_command(0xA6)  # Set Normal Display
        self._write_command(0xAF)  # Display ON

    def clear_display(self, color=0xFF, direction=1):
        # Clear display with direction control
        if direction == 1:  # Top to bottom
            for page in range(8):
                self._clear_page(page, color)
        elif direction == 2:  # Bottom to top
            for page in reversed(range(8)):
                self._clear_page(page, color)
        elif direction == 3:  # Left to right
            for col in range(128):
                for page in range(8):
                    self._set_position(page, col)
                    self._write_data(color)
        elif direction == 4:  # Right to left
            for col in reversed(range(128)):
                for page in range(8):
                    self._set_position(page, col)
                    self._write_data(color)

    def _clear_page(self, page, color):
        # Helper to clear a single page
        self._write_command(0xB0 + page)  # Set page address
        self._write_command(0x00)  # Set lower column start address
        self._write_command(0x10)  # Set upper column start address
        for _ in range(128):
            self._write_data(color)

    def _set_position(self, page, col):
        # Helper to set the cursor position
        self._write_command(0xB0 + page)  # Set page address
        self._write_command(0x00 | (col & 0x0F))  # Set lower column start address
        self._write_command(0x10 | (col >> 4))  # Set upper column start address

    def display_buffer(self, buffer):
        # Send each byte of the display buffer data to the screen
        for page in range(8):  # Loop over 8 pages (64 pixels height / 8 rows per page)
            self._write_command(0xB0 + page)  # Set page address
            self._write_command(0x00)  # Set lower column start address
            self._write_command(0x10)  # Set upper column start address
            for col in range(128):  # Loop over 128 columns (full display width)
                self._write_data(buffer[page * 128 + col])
