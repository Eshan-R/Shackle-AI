import os
import sys
import logging
from logging.handlers import RotatingFileHandler

_LOG_DIR = os.path.expanduser("~/Documents/ShackleAI/logs")
_LOG_FILE = os.path.join(_LOG_DIR, "shackle.log")
_FALLBACK_CRASH_FILE = os.path.join(_LOG_DIR, "crash_fallback.txt")


def ensure_log_dir():
    try:
        os.makedirs(_LOG_DIR, exist_ok=True)
    except Exception as e:
        write_crash_fallback(f"Failed to create log directory '{_LOG_DIR}': {e}")


def write_crash_fallback(message: str):
    """
    Emergency fallback logger using basic file I/O.
    Has zero dependency on sys.stdout, sys.stderr, or the logging module.
    """
    try:
        os.makedirs(_LOG_DIR, exist_ok=True)
        import time
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        with open(_FALLBACK_CRASH_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{ts}] [CRASH_FALLBACK] {message}\n")
    except Exception:
        pass


def get_logger(name: str = "ShackleAI") -> logging.Logger:
    """
    Returns a configured logger with a RotatingFileHandler at ~/Documents/ShackleAI/logs/shackle.log.
    Attaches a StreamHandler ONLY when sys.stdout is not None, ensuring windowed/no-console builds
    never crash with AttributeError.
    """
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger

    logger.setLevel(logging.INFO)
    ensure_log_dir()

    formatter = logging.Formatter(
        "[%(asctime)s] [%(levelname)s] [%(name)s]: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

    # 1. Rotating File Handler (5MB max, 3 backups)
    try:
        file_handler = RotatingFileHandler(
            _LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
        )
        file_handler.setLevel(logging.INFO)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    except Exception as e:
        write_crash_fallback(f"Failed to attach RotatingFileHandler to '{_LOG_FILE}': {e}")

    # 2. Console Stream Handler — ONLY when sys.stdout is present
    if sys.stdout is not None:
        try:
            console_handler = logging.StreamHandler(sys.stdout)
            console_handler.setLevel(logging.INFO)
            console_handler.setFormatter(formatter)
            logger.addHandler(console_handler)
        except Exception:
            pass

    return logger
