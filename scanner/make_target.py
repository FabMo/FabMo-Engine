"""Generate a printable chessboard calibration target (US Letter, 300 DPI).

Print at 100% scale ("Actual size" — NOT fit-to-page), then measure one
square with calipers and pass the true size to calibrate_intrinsics.py.
Displaying on a flat tablet/monitor screen also works in a pinch.
"""

import numpy as np
import cv2

COLS, ROWS = 10, 7          # squares; inner corners = 9x6
SQUARE_PX = 236             # 20 mm at 300 DPI
DPI = 300
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

cv2.putText(page, "9x6 inner corners, squares 20.0 mm at 300 DPI - print Actual Size",
            (x0, y0 - 40), cv2.FONT_HERSHEY_SIMPLEX, 2, 0, 4)
cv2.imwrite("chessboard_letter.png", page)
print("wrote chessboard_letter.png (print at 300 DPI / actual size; squares 20 mm)")
