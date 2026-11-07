"""Generate a printable chessboard calibration target (US Letter, 300 DPI).

Usage: python3 make_target.py [square_mm]      (default 20)

Writes chessboard_<N>mm.png and chessboard_<N>mm.pdf. Print the PDF at
100% scale ("Actual size" — NOT fit-to-page; the PDF carries its physical
page size, a bare PNG often gets scaled). Then measure across several
squares with calipers and pass the true size to calibrate_intrinsics.py.

Pick the square size so the whole board fills roughly half the camera
view at the scanning standoff — there must be room to tilt the board and
push it into the image corners. Displaying on a flat tablet/monitor
screen also works in a pinch.
"""

import sys

import numpy as np
import cv2
from PIL import Image

COLS, ROWS = 10, 7          # squares; inner corners = 9x6
DPI = 300
SQUARE_MM = float(sys.argv[1]) if len(sys.argv) > 1 else 20.0
SQUARE_PX = int(round(SQUARE_MM / 25.4 * DPI))
REAL_MM = SQUARE_PX * 25.4 / DPI   # what actually prints after rounding
PAGE_W, PAGE_H = int(8.5 * DPI), int(11 * DPI)

board = np.full((ROWS * SQUARE_PX, COLS * SQUARE_PX), 255, np.uint8)
for r in range(ROWS):
    for c in range(COLS):
        if (r + c) % 2 == 0:
            board[r*SQUARE_PX:(r+1)*SQUARE_PX, c*SQUARE_PX:(c+1)*SQUARE_PX] = 0

page = np.full((PAGE_H, PAGE_W), 255, np.uint8)
y0 = (PAGE_H - board.shape[0]) // 2
x0 = (PAGE_W - board.shape[1]) // 2
page[y0:y0+board.shape[0], x0:x0+board.shape[1]] = board

label = "9x6 inner corners, squares %.2f mm at 300 DPI - print Actual Size" % REAL_MM
cv2.putText(page, label, (150, y0 - 60), cv2.FONT_HERSHEY_SIMPLEX, 1.6, 0, 3)

base = "chessboard_%gmm" % SQUARE_MM
img = Image.fromarray(page)
img.save(base + ".png", dpi=(DPI, DPI))
img.save(base + ".pdf", resolution=DPI)
print("wrote %s.pdf / .png — print at Actual Size; squares %.2f mm, board %.0f x %.0f mm"
      % (base, REAL_MM, COLS * REAL_MM, ROWS * REAL_MM))
