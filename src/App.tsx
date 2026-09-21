import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [name, setName] = useState("Sift");

  useEffect(() => {
    void invoke<string>("app_name")
      .then(setName)
      .catch(() => setName("Sift"));
  }, []);

  return (
    <main className="shell">
      <h1>{name}</h1>
      <p>Local sample manager</p>
    </main>
  );
}

export default App;
