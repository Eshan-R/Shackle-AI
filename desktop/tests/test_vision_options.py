import unittest
from mediapipe.tasks import python
from mediapipe.tasks.python import vision


class TestVisionOptions(unittest.TestCase):
    def test_mediapipe_landmarker_options_running_mode(self):
        """
        Regression test ensuring both FaceLandmarkerOptions and PoseLandmarkerOptions
        use vision.RunningMode.VIDEO instead of python.RunningMode (which raises AttributeError).
        """
        self.assertTrue(hasattr(vision, "RunningMode"), "vision module must expose RunningMode")
        self.assertTrue(hasattr(vision.RunningMode, "VIDEO"), "vision.RunningMode must expose VIDEO")
        self.assertFalse(hasattr(python, "RunningMode"), "python module must not be confused with vision module")

        face_options = vision.FaceLandmarkerOptions(
            base_options=python.BaseOptions(model_asset_path="desktop/assets/face_landmarker.task"),
            running_mode=vision.RunningMode.VIDEO
        )
        self.assertEqual(face_options.running_mode, vision.RunningMode.VIDEO)

        pose_options = vision.PoseLandmarkerOptions(
            base_options=python.BaseOptions(model_asset_path="desktop/assets/pose_landmarker.task"),
            running_mode=vision.RunningMode.VIDEO
        )
        self.assertEqual(pose_options.running_mode, vision.RunningMode.VIDEO)


if __name__ == "__main__":
    unittest.main()
