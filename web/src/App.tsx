import { Navigate, Route, Routes } from "react-router-dom";
import { AsciiBackground } from "./components/AsciiBackground";
import { SiteCursor } from "./components/SiteCursor";
import { AddCameraPage } from "./pages/AddCameraPage";
import { AuthPage } from "./pages/AuthPage";
import { HomePage } from "./pages/HomePage";

export default function App() {
  return (
    <>
      <AsciiBackground />
      <SiteCursor />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/cameras/new" element={<AddCameraPage />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  );
}
