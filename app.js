const SESSION_KEY = "client-data-token-v1";

const loginScreen = document.querySelector("#loginScreen");
const appShell = document.querySelector(".app-shell");
const loginForm = document.querySelector("#loginForm");
const loginMessage = document.querySelector("#loginMessage");
const sessionText = document.querySelector("#sessionText");
const logoutBtn = document.querySelector("#logoutBtn");
const adminTabs = document.querySelector("#adminTabs");
const adminTabButtons = document.querySelectorAll("[data-admin-view]");
const stockEntryPage = document.querySelector("#stockEntryPage");
const accountPasswordPanel = document.querySelector("#accountPasswordPanel");
const accountPasswordForm = document.querySelector("#accountPasswordForm");
const accountPasswordMessage = document.querySelector("#accountPasswordMessage");
const accountPasswordToggle = document.querySelector("#accountPasswordToggle");

const userPanel = document.querySelector("#userPanel");
const userForm = document.querySelector("#userForm");
const adminPasswordForm = document.querySelector("#adminPasswordForm");
const userList = document.querySelector("#userList");
const userCount = document.querySelector("#userCount");
const newUserBrokerInput = document.querySelector("#newUserBroker");
const newUserCodeInput = document.querySelector("#newUserCode");
const newUserNameInput = document.querySelector("#newUserName");
const cancelUserEditBtn = document.querySelector("#cancelUserEditBtn");
const saveUserBtn = document.querySelector("#saveUserBtn");
const stockBrokerText = document.querySelector("#stockBrokerText");

const form = document.querySelector("#clientForm");
const recordsList = document.querySelector("#recordsList");
const emptyState = document.querySelector("#emptyState");
const recordCount = document.querySelector("#recordCount");
const template = document.querySelector("#recordTemplate");
const clearBtn = document.querySelector("#clearBtn");
const deleteAllBtn = document.querySelector("#deleteAllBtn");
const exportBtn = document.querySelector("#exportBtn");
const clientCodeInput = document.querySelector("#clientCode");
const clientCodeOptions = document.querySelector("#clientCodeOptions");
const shareNameInput = document.querySelector("#shareName");
const shareSymbolInput = document.querySelector("#shareSymbol");
const shareOptions = document.querySelector("#shareOptions");
const shareStatus = document.querySelector("#shareStatus");
const startingPriceInput = document.querySelector("#startingPrice");
const lowerLimitInput = document.querySelector("#lowerLimit");
const orderQtyInput = document.querySelector("#orderQty");
const buyEntryStepInput = document.querySelector("#buyEntryStep");
const entryCountPreview = document.querySelector("#entryCountPreview");
const totalFundPreview = document.querySelector("#totalFundPreview");
const avgPricePreview = document.querySelector("#avgPricePreview");
const profitPerStepPreview = document.querySelector("#profitPerStepPreview");
const totalProfitPreview = document.querySelector("#totalProfitPreview");
const weekHighPreview = document.querySelector("#weekHighPreview");
const weekLowPreview = document.querySelector("#weekLowPreview");

const fields = ["clientCode", "shareName", "brokerName", "shareSymbol", "livePrice", "startingPrice", "lowerLimit", "orderQty", "buyEntryStep", "buyExitStep", "entryCount", "totalFund", "avgPrice", "profitPerStep", "totalProfit"];

let currentUser = null;
let currentRecords = [];
let clientUsers = [];
let shareSearchTimer = null;
let shareSuggestions = [];
let adminView = "users";
let editingUserCode = "";

function getToken() {
  return sessionStorage.getItem(SESSION_KEY);
}

function setToken(token) {
  sessionStorage.setItem(SESSION_KEY, token);
}

function clearToken() {
  sessionStorage.removeItem(SESSION_KEY);
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const timeoutMs = options.timeoutMs || 0;
  const controller = timeoutMs ? new AbortController() : null;
  const timeoutId = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;

  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const { timeoutMs: _timeoutMs, ...fetchOptions } = options;
    const response = await fetch(path, { ...fetchOptions, headers, signal: controller ? controller.signal : options.signal });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "Request failed.");
    }

    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Request is taking too long. Please try again, or check internet connection on the server computer.");
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function isAdmin() {
  return currentUser && currentUser.role === "admin";
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

function calculateDeployment(startingPrice, lowerLimit, orderQty, buyEntryStep, buyExitStep = 0) {
  const starting = Number(startingPrice);
  const lower = Number(lowerLimit);
  const qty = Number(orderQty);
  const step = Number(buyEntryStep);
  const exitStep = Number(buyExitStep);

  if (!Number.isFinite(starting) || !Number.isFinite(lower) || !Number.isFinite(qty) || !Number.isFinite(step) || !Number.isFinite(exitStep)) {
    return null;
  }
  if (starting <= 0 || lower <= 0 || qty <= 0 || lower > starting) {
    return null;
  }

  const levels = [];
  if (step <= 0) {
    return null;
  }

  const entryCount = Math.floor(((starting - lower) / step) + 1e-9);
  for (let index = 1; index <= entryCount && levels.length < 10000; index += 1) {
    levels.push(Number((starting - step * index).toFixed(2)));
  }
  if (!levels.length) {
    return null;
  }

  const total = levels.reduce((sum, price) => sum + price * qty, 0);
  const profitPerStep = Math.max(exitStep, 0) * qty;
  return { entryCount: levels.length, totalFund: total, avgPrice: total / (levels.length * qty), profitPerStep, totalProfit: profitPerStep * levels.length };
}

function updateFundPreview() {
  const deployment = calculateDeployment(
    startingPriceInput.value,
    lowerLimitInput.value,
    orderQtyInput.value,
    buyEntryStepInput.value,
    document.querySelector("#buyExitStep").value
  );

  if (!deployment) {
    entryCountPreview.textContent = "-";
    totalFundPreview.textContent = "-";
    avgPricePreview.textContent = "-";
    profitPerStepPreview.textContent = "-";
    totalProfitPreview.textContent = "-";
    return;
  }

  entryCountPreview.textContent = String(deployment.entryCount);
  totalFundPreview.textContent = formatMoney(deployment.totalFund);
  avgPricePreview.textContent = formatMoney(deployment.avgPrice);
  profitPerStepPreview.textContent = formatMoney(deployment.profitPerStep);
  totalProfitPreview.textContent = formatMoney(deployment.totalProfit);
}

function updateWeekRangePreview(quote = {}) {
  weekHighPreview.textContent = quote.fiftyTwoWeekHigh ? formatMoney(Number(quote.fiftyTwoWeekHigh)) : "-";
  weekLowPreview.textContent = quote.fiftyTwoWeekLow ? formatMoney(Number(quote.fiftyTwoWeekLow)) : "-";
}

function validatePriceLimits(startingPrice, lowerLimit) {
  const starting = Number(startingPrice);
  const lower = Number(lowerLimit);

  if (!Number.isFinite(starting) || !Number.isFinite(lower)) {
    return "Starting Price and Lower Limit must be valid numbers.";
  }

  if (lower > starting) {
    return "Lower Limit cannot be higher than Starting Price.";
  }

  return "";
}

function setAdminView(view) {
  const allowedView = view === "stock" || view === "users" ? view : "users";
  adminView = !isAdmin() && allowedView === "users" ? "stock" : allowedView;

  const showingUsers = isAdmin() && adminView === "users";
  const showingStock = adminView === "stock";

  adminTabs.style.display = "grid";
  userPanel.style.display = showingUsers ? "block" : "none";
  stockEntryPage.style.display = showingStock ? "block" : "none";
  exportBtn.style.display = showingStock ? "inline-block" : "none";

  adminTabButtons.forEach((button) => {
    const isUserTab = button.dataset.adminView === "users";
    button.style.display = !isAdmin() && isUserTab ? "none" : "block";
    const selected = button.dataset.adminView === adminView;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
}
function brokerForClient(clientCode) {
  const code = normalizeCode(clientCode);
  if (!code) return "";
  if (!isAdmin() && currentUser && currentUser.code === code) {
    return currentUser.brokerName || "";
  }
  const user = clientUsers.find((entry) => entry.code === code);
  return user ? user.brokerName || "" : "";
}

function updateStockBrokerText() {
  const broker = currentUser ? currentUser.brokerName || "" : "";
  stockBrokerText.textContent = broker ? "Broker: " + broker : "Broker: Not assigned";
}
function setShareStatus(message, state = "") {
  shareStatus.textContent = message;
  shareStatus.className = `helper-text${state ? ` is-${state}` : ""}`;
}

async function loadMe() {
  if (!getToken()) return null;

  try {
    const payload = await api("/api/me");
    currentUser = payload.user;
    return currentUser;
  } catch {
    clearToken();
    currentUser = null;
    return null;
  }
}

function clearUserEdit() {
  editingUserCode = "";
  userForm.reset();
  newUserCodeInput.readOnly = false;
  saveUserBtn.textContent = "Create / Update User";
  cancelUserEditBtn.style.display = "none";
}

function startUserEdit(user) {
  editingUserCode = user.code;
  newUserCodeInput.value = user.code;
  newUserCodeInput.readOnly = true;
  newUserNameInput.value = user.name;
  newUserBrokerInput.value = user.brokerName || "";
  saveUserBtn.textContent = "Update User";
  cancelUserEditBtn.style.display = "block";
  newUserNameInput.focus();
}
async function loadUsers() {
  if (!isAdmin()) return;

  const payload = await api("/api/users");
  clientUsers = payload.users;
  clientCodeOptions.innerHTML = "";
  userList.innerHTML = "";
  userCount.textContent = `${clientUsers.length} users`;

  clientUsers.forEach((user) => {
    const option = document.createElement("option");
    option.value = user.code;
    option.label = user.brokerName ? `${user.name} - ${user.brokerName}` : user.name;
    clientCodeOptions.appendChild(option);

    const row = document.createElement("div");
    row.className = "user-row";

    const code = document.createElement("strong");
    const name = document.createElement("span");
    const broker = document.createElement("select");
    const editButton = document.createElement("button");
    const resetButton = document.createElement("button");
    const button = document.createElement("button");

    code.textContent = user.code;
    name.textContent = user.name;
    broker.className = "broker-row-select";
    broker.innerHTML = '<option value="">Broker not set</option><option value="Kotak Neo">Kotak Neo</option><option value="SMC Global">SMC Global</option>';
    broker.value = user.brokerName || "";
    editButton.className = "secondary row-action";
    editButton.type = "button";
    editButton.textContent = "Edit";
    resetButton.className = "secondary row-action";
    resetButton.type = "button";
    resetButton.textContent = "Reset Password";
    button.className = "delete-record row-action";
    button.type = "button";
    button.textContent = "Delete";

    row.append(code, name, broker, editButton, resetButton, button);

    broker.addEventListener("change", async () => {
      try {
        await api("/api/users", {
          method: "POST",
          body: JSON.stringify({
            code: user.code,
            name: user.name,
            brokerName: broker.value,
            password: "123",
          }),
        });
        await loadUsers();
        updateStockBrokerText();
      } catch (error) {
        alert(error.message);
        broker.value = user.brokerName || "";
      }
    });

    editButton.addEventListener("click", () => startUserEdit(user));

    resetButton.addEventListener("click", async () => {
      if (!confirm(`Reset password for ${user.code} to 123?`)) return;
      try {
        await api("/api/reset-password", { method: "POST", body: JSON.stringify({ code: user.code }) });
        alert("Client password has been reset to 123.");
      } catch (error) {
        alert(error.message);
      }
    });

    button.addEventListener("click", async () => {
      if (!confirm(`Delete user ${user.code}? Saved records for this user will not be deleted.`)) return;
      await api(`/api/users/${encodeURIComponent(user.code)}`, { method: "DELETE" });
      await loadUsers();
    });

    userList.appendChild(row);
  });
}

async function loadRecords() {
  const payload = await api("/api/records");
  currentRecords = payload.records;
  renderRecords();
}

function resetStockEntryForm() {
  form.reset();
  setShareStatus("Select an NSE share from search suggestions to fetch live price.");
  shareOptions.innerHTML = "";
  shareSuggestions = [];
  updateWeekRangePreview();
  updateFundPreview();
  if (!isAdmin()) {
    clientCodeInput.value = currentUser.code;
  }
  updateStockBrokerText();
}

function goToAddStock() {
  resetStockEntryForm();
  setAdminView("stock");
  window.scrollTo({ top: 0, behavior: "smooth" });
  shareNameInput.focus();
}
function renderRecords() {
  recordsList.innerHTML = "";
  recordCount.textContent = `${currentRecords.length} saved`;
  emptyState.style.display = currentRecords.length ? "none" : "block";
  deleteAllBtn.style.display = isAdmin() ? "inline-block" : "none";

  currentRecords.forEach((record) => {
    const item = template.content.cloneNode(true);
    item.querySelector(".record-card").classList.add("compact-row");
    item.querySelector('[data-field="clientCode"]').textContent = record.shareSymbol || "-";
    item.querySelector('[data-field="shareName"]').textContent = record.shareName;
    item.querySelector('[data-field="brokerName"]').textContent = record.brokerName || "-";
    item.querySelector('[data-field="createdAt"]').textContent = formatDate(record.createdAt);
    item.querySelector('[data-field="shareSymbol"]').textContent = record.shareSymbol || "-";
    item.querySelector('[data-field="livePrice"]').textContent = record.livePrice || "-";

    fields.slice(4).forEach((field) => {
      const value = record[field];
      item.querySelector(`[data-field="${field}"]`).textContent = (field === "totalFund" || field === "avgPrice" || field === "profitPerStep" || field === "totalProfit") && value ? formatMoney(Number(value)) : value || "-";
    });

    item.querySelector(".delete-record").addEventListener("click", async () => {
      await api(`/api/records/${encodeURIComponent(record.id)}`, { method: "DELETE" });
      await loadRecords();
    });


    recordsList.appendChild(item);
  });
}

async function renderSession() {
  const loggedIn = Boolean(currentUser);
  loginScreen.style.display = loggedIn ? "none" : "grid";
  appShell.style.display = loggedIn ? "block" : "none";

  if (!currentUser) return;

  sessionText.textContent = `${currentUser.name} (${currentUser.code})`;
  setAdminView(isAdmin() ? adminView : "stock");
  accountPasswordPanel.style.display = isAdmin() ? "none" : "block";
  accountPasswordPanel.classList.remove("is-open");
  accountPasswordToggle.setAttribute("aria-expanded", "false");

  clientCodeInput.value = currentUser.code;

  await Promise.all([loadRecords(), loadUsers()]);
  updateStockBrokerText();
}

function getFormData() {
  const data = Object.fromEntries(new FormData(form).entries());
  const clientCode = currentUser.code;

  const deployment = calculateDeployment(data.startingPrice, data.lowerLimit, data.orderQty, data.buyEntryStep, data.buyExitStep);

  return {
    clientCode,
    shareName: data.shareName.trim().toUpperCase(),
    shareSymbol: data.shareSymbol,
    startingPrice: data.startingPrice,
    lowerLimit: data.lowerLimit,
    orderQty: data.orderQty,
    buyEntryStep: data.buyEntryStep,
    buyExitStep: data.buyExitStep,
    entryCount: deployment ? String(deployment.entryCount) : "",
    totalFund: deployment ? deployment.totalFund.toFixed(2) : "",
    avgPrice: deployment ? deployment.avgPrice.toFixed(2) : "",
    profitPerStep: deployment ? deployment.profitPerStep.toFixed(2) : "",
    totalProfit: deployment ? deployment.totalProfit.toFixed(2) : "",
  };
}

function exportCsv() {
  if (!currentRecords.length) {
    alert("Please save at least one record before exporting.");
    return;
  }

  const headers = ["Broker", "Share Name", "Share Symbol", "Live Price", "Starting Price", "Lower Limit", "Order Qty", "Buy Entry Step", "Buy Exit Step", "Estimated Entries", "Total Fund Deployed", "Average Entry Price", "Profit Per Step", "Total Profit at Max Entries", "Saved At"];
  const rows = currentRecords.map((record) => [
    record.brokerName || "",
    record.shareName,
    record.shareSymbol || "",
    record.livePrice || "",
    record.startingPrice,
    record.lowerLimit,
    record.orderQty,
    record.buyEntryStep,
    record.buyExitStep,
    record.entryCount || "",
    record.totalFund || "",
    record.avgPrice || "",
    record.profitPerStep || "",
    record.totalProfit || "",
    formatDate(record.createdAt),
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `client-records-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "";

  try {
    const data = Object.fromEntries(new FormData(loginForm).entries());
    const payload = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        code: normalizeCode(data.loginCode),
        password: String(data.loginPassword).trim(),
      }),
    });

    setToken(payload.token);
    currentUser = payload.user;
    loginForm.reset();
    await renderSession();
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});

adminTabButtons.forEach((button) => {
  button.addEventListener("click", () => setAdminView(button.dataset.adminView));
});

logoutBtn.addEventListener("click", async () => {
  clearToken();
  currentUser = null;
  currentRecords = [];
  adminView = "users";
  form.reset();
  await renderSession();
});

cancelUserEditBtn.addEventListener("click", clearUserEdit);
clearUserEdit();

userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(userForm).entries());

  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        code: normalizeCode(data.newUserCode),
        name: data.newUserName.trim(),
        brokerName: data.newUserBroker,
        password: "123",
      }),
    });

    clearUserEdit();
    await loadUsers();
  } catch (error) {
    alert(error.message);
  }
});

accountPasswordToggle.addEventListener("click", () => {
  const isOpen = accountPasswordPanel.classList.toggle("is-open");
  accountPasswordToggle.setAttribute("aria-expanded", String(isOpen));
});

accountPasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  accountPasswordMessage.textContent = "";
  accountPasswordMessage.className = "helper-text";
  const data = Object.fromEntries(new FormData(accountPasswordForm).entries());

  try {
    await api("/api/change-password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: data.currentUserPassword,
        newPassword: data.newUserLoginPassword,
      }),
    });

    accountPasswordForm.reset();
    accountPasswordMessage.textContent = "Password updated.";
    accountPasswordMessage.className = "helper-text is-success";
  } catch (error) {
    accountPasswordMessage.textContent = error.message;
    accountPasswordMessage.className = "helper-text is-error";
  }
});

adminPasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(adminPasswordForm).entries());

  try {
    await api("/api/admin-password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: data.currentAdminPassword,
        newPassword: data.newAdminPassword,
      }),
    });

    adminPasswordForm.reset();
    alert("Admin password has been updated.");
  } catch (error) {
    alert(error.message);
  }
});

async function searchShares(query) {
  if (query.length < 2) {
    shareOptions.innerHTML = "";
    return;
  }

  try {
    const payload = await api(`/api/shares/search?q=${encodeURIComponent(query)}`);
    shareSuggestions = payload.results;
    shareOptions.innerHTML = "";

    shareSuggestions.forEach((share) => {
      const option = document.createElement("option");
      option.value = share.label;
      option.label = `${share.symbol} ${share.exchange || ""}`;
      shareOptions.appendChild(option);
    });
  } catch {
    setShareStatus("NSE share search is currently unavailable. Check internet connection on the server computer.", "error");
  }
}

async function fetchLivePrice(share) {
  setShareStatus(`Fetching live price for ${share.symbol}...`);

  try {
    const payload = await api(`/api/shares/quote?symbol=${encodeURIComponent(share.symbol)}`);
    const price = payload.quote.price;
    shareSymbolInput.value = share.symbol;
    shareNameInput.value = share.name || share.symbol;
    startingPriceInput.value = price;
    updateWeekRangePreview(payload.quote);
    updateFundPreview();
    setShareStatus(`Live price: ${payload.quote.currency || ""} ${price} (${share.symbol})`, "success");
  } catch (error) {
    shareSymbolInput.value = "";
    updateWeekRangePreview();
    setShareStatus(error.message, "error");
  }
}

clientCodeInput.addEventListener("input", updateStockBrokerText);

[startingPriceInput, lowerLimitInput, orderQtyInput, buyEntryStepInput, document.querySelector("#buyExitStep")].forEach((input) => {
  input.addEventListener("input", updateFundPreview);
});

shareNameInput.addEventListener("input", () => {
  const value = shareNameInput.value.trim();
  const selectedShare = shareSuggestions.find((share) => share.label === value);

  if (selectedShare) {
    fetchLivePrice(selectedShare);
    return;
  }

  shareSymbolInput.value = "";
  updateWeekRangePreview();
  setShareStatus("Select an NSE share from search suggestions to fetch live price.");
  clearTimeout(shareSearchTimer);
  shareSearchTimer = setTimeout(() => searchShares(value), 350);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!shareSymbolInput.value) {
    alert("Please select an NSE share from the search suggestions before saving.");
    shareNameInput.focus();
    return;
  }

  const data = Object.fromEntries(new FormData(form).entries());
  const priceLimitError = validatePriceLimits(data.startingPrice, data.lowerLimit);
  if (priceLimitError) {
    alert(priceLimitError);
    document.querySelector("#lowerLimit").focus();
    return;
  }

  try {
    await api("/api/records", {
      method: "POST",
      body: JSON.stringify(getFormData()),
    });

    resetStockEntryForm();
    shareNameInput.focus();
    await loadRecords();
  } catch (error) {
    alert(error.message);
  }
});

clearBtn.addEventListener("click", () => {
  resetStockEntryForm();
  shareNameInput.focus();
});

deleteAllBtn.addEventListener("click", async () => {
  if (!isAdmin()) return;
  if (!currentRecords.length) return;
  if (confirm("Delete all saved records? This action cannot be undone.")) {
    await api("/api/records", { method: "DELETE" });
    await loadRecords();
  }
});

exportBtn.addEventListener("click", exportCsv);

async function clearAppCache() {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  if ("caches" in window) {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  }
}

clearAppCache().finally(() => {
  updateFundPreview();
  loadMe().then(renderSession);
});
