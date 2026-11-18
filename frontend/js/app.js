// Home page + login. All accounts, passwords and data now live on the backend server.
const API = (window.TIMEOFF_API_BASE || "").replace(/\/$/, "") + "/api";
const TOKEN_KEY = "elms_token_v2";

function roleDestination(role) {
  return ({ employee: "pages/employee/dashboard.html", manager: "pages/manager/dashboard.html", admin: "pages/admin/dashboard.html" })[role];
}

async function handleLogin(event) {
  event.preventDefault();
  const error = document.getElementById("loginError");
  const button = event.target.querySelector(".sign-in-btn");
  error.textContent = "";
  const identity = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  button.disabled = true;
  try {
    const res = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identity, password }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { error.textContent = data.error || "We couldn't verify those credentials. Please try again."; return; }
    localStorage.setItem(TOKEN_KEY, data.token);
    window.location.href = roleDestination(data.user.role);
  } catch {
    error.textContent = "Cannot reach the server. Please make sure the backend is running (npm start in the backend folder).";
  } finally { button.disabled = false; }
}

// If a valid session already exists, offer a quick way back in.
async function checkExistingSession() {
  const token = localStorage.getItem(TOKEN_KEY); if (!token) return;
  try {
    const res = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { localStorage.removeItem(TOKEN_KEY); return; }
    const { user } = await res.json();
    const note = document.getElementById("loginError");
    note.innerHTML = `Already signed in as ${user.name}. <a href="${roleDestination(user.role)}" style="color:inherit;text-decoration:underline">Open your workspace</a>`;
    note.classList.add("success-message");
  } catch { /* server not reachable: ignore here, login will show the message */ }
}

document.addEventListener("DOMContentLoaded", () => {
  const heroDate = document.getElementById("heroDate");
  if (heroDate) heroDate.textContent = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }).toUpperCase();
  document.getElementById("loginForm")?.addEventListener("submit", handleLogin);
  checkExistingSession();
  document.getElementById("togglePassword")?.addEventListener("click", event => {
    const field = document.getElementById("password"); const visible = field.type === "password";
    field.type = visible ? "text" : "password"; event.currentTarget.textContent = visible ? "Hide" : "Show";
    event.currentTarget.setAttribute("aria-label", visible ? "Hide password" : "Show password");
  });
  const menuButton = document.getElementById("menuToggle"); const nav = document.querySelector(".topnav");
  menuButton?.addEventListener("click", () => {
    const open = nav.classList.toggle("open"); menuButton.setAttribute("aria-expanded", String(open));
  });
  nav?.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
    nav.classList.remove("open"); menuButton?.setAttribute("aria-expanded", "false");
  }));
});
