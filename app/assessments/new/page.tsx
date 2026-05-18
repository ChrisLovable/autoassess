"use client";
import { useEffect, useState } from "react";

export default function Debug() {
  const [msg, setMsg] = useState("[mounting]");
  const [ua, setUa] = useState("[mounting]");
  const [secure, setSecure] = useState("[mounting]");

  useEffect(() => {
    setUa(navigator.userAgent);
    setSecure(String(window.isSecureContext));
    setMsg("useEffect fired - calling getUserMedia...");
    
    if (!navigator.mediaDevices) {
      setMsg("FAIL: navigator.mediaDevices is undefined");
      return;
    }
    
    navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: { ideal: "environment" } }, 
      audio: false 
    })
      .then(stream => {
        const tracks = stream.getVideoTracks();
        setMsg("SUCCESS: " + tracks.length + " tracks, label=" + (tracks[0]?.label || "(no label)"));
      })
      .catch(err => {
        setMsg("ERROR: " + err.name + " / " + (err.message || String(err)));
      });
  }, []);

  return (
    <div style={{ padding: 20, background: "#0A0A0A", color: "white", minHeight: "100vh", fontFamily: "monospace", fontSize: 14 }}>
      <h2 style={{ color: "#D4AF37", marginTop: 0 }}>Camera Debug v2</h2>
      <div style={{ marginBottom: 10 }}>UA: {ua}</div>
      <div style={{ marginBottom: 10 }}>Secure: {secure}</div>
      <div style={{ marginBottom: 10, padding: 10, background: "#222", borderRadius: 6 }}>Status: {msg}</div>
    </div>
  );
}