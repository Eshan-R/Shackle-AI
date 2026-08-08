import sys
import os

# Add project root to sys.path so backend imports resolve cleanly
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.main import app