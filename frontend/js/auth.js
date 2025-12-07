const SERVER_URL = "https://ofd-backend-czgu.onrender.com";

function saveAuth(data) {
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    updateHeaderUser();
}

function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    updateHeaderUser();
    location.href = "index.html";
}

function getUser() {
    try { return JSON.parse(localStorage.getItem("user")); } catch { return null; }
}
function isLogged() { return !!localStorage.getItem("token"); }

function updateHeaderUser() {
    const userBtn = document.getElementById("profileBtn");
    if (!userBtn) return;
    const user = getUser();
    if (user) {
        userBtn.textContent = `Привет, ${user.name}! 👤`;
        userBtn.onclick = () => location.href = "profile.html";
    } else {
        userBtn.textContent = "Профиль";
        userBtn.onclick = () => { alert("Войдите через форму внизу (реализуй модал)"); };
    }
}
document.addEventListener("DOMContentLoaded", updateHeaderUser);
