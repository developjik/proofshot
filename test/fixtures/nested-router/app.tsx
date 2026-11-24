import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
function Layout() {
  return (
    <main>
      <header>Dashboard workspace</header>
      <Outlet />
    </main>
  );
}
function Settings() {
  return (
    <section>
      <h1>Nested Settings</h1>
      <p id="proof">This is /dashboard/settings, not /settings.</p>
      <label>
        Notification email <input defaultValue="team@example.test" />
      </label>
      <button>Save preferences</button>
    </section>
  );
}
function Overview() {
  return <h1>Dashboard overview</h1>;
}
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/dashboard" element={<Layout />}>
          <Route index element={<Overview />} />
          <Route element={<Outlet />}>
            <Route path="settings" element={<Settings />} />
          </Route>
        </Route>
        <Route path="*" element={<h1>Wrong capture target</h1>} />
      </Routes>
    </BrowserRouter>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
