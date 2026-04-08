const RENTAL_ORDERS_TABLE = "rental_orders";
const CONTRACTORS_TABLE = "contractors";

const buildVersion = document.getElementById("build-version");
const dataMode = document.getElementById("data-mode");
const contractorsSearch = document.getElementById("contractors-search");
const contractorsStats = document.getElementById("contractors-stats");
const contractorsBody = document.getElementById("contractors-body");
const contractorsResult = document.getElementById("contractors-result");
const contractorRowTemplate = document.getElementById("contractor-row-template");
const openContractorModalButton = document.getElementById("open-contractor-modal");
const contractorModal = document.getElementById("contractor-modal");
const contractorCreateForm = document.getElementById("contractor-create-form");

const contractorFields = {
  name: document.getElementById("new-contractor-name"),
  contact: document.getElementById("new-contractor-contact"),
  phone: document.getElementById("new-contractor-phone"),
  email: document.getElementById("new-contractor-email"),
  notes: document.getElementById("new-contractor-notes"),
};

const supabaseUrl = window.APP_CONFIG?.supabaseUrl || "";
const supabaseAnonKey = window.APP_CONFIG?.supabaseAnonKey || "";
const supabaseClient = window.supabase?.createClient(supabaseUrl, supabaseAnonKey);

let hasSettlementColumn = true;
let hasContractorsTable = true;
let rentalOrders = [];
let contractors = [];

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function ensureSupabaseConfigured() {
  if (!supabaseUrl || !supabaseAnonKey || !supabaseClient) {
    throw new Error("Brak konfiguracji Supabase w config.js");
  }
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "nieznana data";
  return date.toLocaleString("pl-PL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function loadBuildVersion() {
  if (!buildVersion) return;
  try {
    const response = await fetch(`build-info.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Brak metadanych");
    const info = await response.json();
    const shortCommit = String(info.commit || "").slice(0, 7) || "lokalna";
    buildVersion.textContent = `Wersja: ${shortCommit} • ${formatDateTime(info.deployedAt)}`;
  } catch {
    buildVersion.textContent = "Wersja: lokalna";
  }
}

function renderDataMode(status = "Dane: Supabase (cloud)") {
  if (dataMode) dataMode.textContent = status;
}

function setContractorsResult(message = "", tone = "") {
  contractorsResult.textContent = message;
  contractorsResult.className = "csv-result";
  if (tone) {
    contractorsResult.classList.add(tone);
  }
}

async function detectSettlementColumn() {
  const { error } = await supabaseClient
    .from(RENTAL_ORDERS_TABLE)
    .select("id, settled_at")
    .limit(1);

  if (!error) {
    hasSettlementColumn = true;
    return;
  }

  if (error.code === "42703" || /settled_at/i.test(error.message)) {
    hasSettlementColumn = false;
    return;
  }

  throw new Error(`Blad sprawdzania kolumny rozliczenia: ${error.message}`);
}

async function detectContractorsTable() {
  const { error } = await supabaseClient
    .from(CONTRACTORS_TABLE)
    .select("id, name")
    .limit(1);

  if (!error) {
    hasContractorsTable = true;
    return;
  }

  if (error.code === "42P01") {
    hasContractorsTable = false;
    return;
  }

  throw new Error(`Blad sprawdzania tabeli kontrahentow: ${error.message}`);
}

async function fetchRentalOrders() {
  const selectFields = hasSettlementColumn
    ? "id, contractor_name, contractor_contact, contractor_phone, contractor_email, declared_return_date, actual_return_date, settled_at"
    : "id, contractor_name, contractor_contact, contractor_phone, contractor_email, declared_return_date, actual_return_date";

  const { data, error } = await supabaseClient
    .from(RENTAL_ORDERS_TABLE)
    .select(selectFields)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Blad pobierania WZ: ${error.message}`);
  rentalOrders = data || [];
}

async function fetchContractors() {
  if (!hasContractorsTable) {
    contractors = [];
    return;
  }

  const { data, error } = await supabaseClient
    .from(CONTRACTORS_TABLE)
    .select("id, name, contact, phone, email, notes, created_at")
    .order("name", { ascending: true });

  if (error) throw new Error(`Blad pobierania kontrahentow: ${error.message}`);
  contractors = data || [];
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function getDaysToReturn(dateValue) {
  if (!dateValue) return null;
  const target = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const diffMs = target.getTime() - startOfToday().getTime();
  return Math.round(diffMs / 86400000);
}

function buildContractorsViewModel() {
  const map = new Map();

  for (const contractor of contractors) {
    const key = normalizeText(contractor.name);
    if (!key) continue;
    map.set(key, {
      id: contractor.id,
      name: contractor.name,
      contact: contractor.contact || "",
      phone: contractor.phone || "",
      email: contractor.email || "",
      allCount: 0,
      returnedCount: 0,
      inProgressCount: 0,
      overdueCount: 0,
    });
  }

  for (const order of rentalOrders) {
    const name = order.contractor_name || "Nieznany kontrahent";
    const key = normalizeText(name);
    if (!map.has(key)) {
      map.set(key, {
        id: null,
        name,
        contact: order.contractor_contact || "",
        phone: order.contractor_phone || "",
        email: order.contractor_email || "",
        allCount: 0,
        returnedCount: 0,
        inProgressCount: 0,
        overdueCount: 0,
      });
    }

    const item = map.get(key);
    item.allCount += 1;

    const isReturned = Boolean(order.actual_return_date);
    const isOverdue = !isReturned && getDaysToReturn(order.declared_return_date) < 0;

    if (isReturned) {
      item.returnedCount += 1;
    } else if (isOverdue) {
      item.overdueCount += 1;
    } else {
      item.inProgressCount += 1;
    }

    if (!item.contact && order.contractor_contact) item.contact = order.contractor_contact;
    if (!item.phone && order.contractor_phone) item.phone = order.contractor_phone;
    if (!item.email && order.contractor_email) item.email = order.contractor_email;
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "pl"));
}

function getFilteredContractors() {
  const query = normalizeText(contractorsSearch.value);
  const rows = buildContractorsViewModel();

  if (!query) return rows;
  return rows.filter((row) => {
    const haystack = [row.name, row.contact, row.phone, row.email]
      .map(normalizeText)
      .join(" ");
    return haystack.includes(query);
  });
}

function renderStats(rows) {
  const allCount = rows.length;
  const allWz = rows.reduce((sum, row) => sum + row.allCount, 0);
  const returned = rows.reduce((sum, row) => sum + row.returnedCount, 0);
  const inProgress = rows.reduce((sum, row) => sum + row.inProgressCount, 0);
  const overdue = rows.reduce((sum, row) => sum + row.overdueCount, 0);

  contractorsStats.innerHTML = [
    ["Kontrahenci", allCount],
    ["WZ wszystkie", allWz],
    ["Zwrocone", returned],
    ["W trakcie", inProgress],
    ["Po terminie", overdue],
  ]
    .map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function renderContractorsTable() {
  const rows = getFilteredContractors();
  contractorsBody.innerHTML = "";

  for (const rowData of rows) {
    const row = contractorRowTemplate.content.cloneNode(true);
    row.querySelector('[data-field="name"]').textContent = rowData.name;
    row.querySelector('[data-field="contact"]').textContent = rowData.contact || "-";
    row.querySelector('[data-field="phone"]').textContent = rowData.phone || "-";
    row.querySelector('[data-field="email"]').textContent = rowData.email || "-";
    row.querySelector('[data-field="allCount"]').textContent = rowData.allCount;
    row.querySelector('[data-field="returnedCount"]').textContent = rowData.returnedCount;
    row.querySelector('[data-field="inProgressCount"]').textContent = rowData.inProgressCount;
    row.querySelector('[data-field="overdueCount"]').textContent = rowData.overdueCount;
    contractorsBody.appendChild(row);
  }

  renderStats(rows);
}

function openContractorModal() {
  contractorModal.classList.remove("hidden");
  contractorFields.name.focus();
}

function closeContractorModal() {
  contractorModal.classList.add("hidden");
  contractorCreateForm.reset();
}

async function createContractor(event) {
  event.preventDefault();
  setContractorsResult();

  if (!hasContractorsTable) {
    throw new Error("Tabela kontrahentow nie jest jeszcze dostepna. Poczekaj na migracje Supabase.");
  }

  const payload = {
    name: contractorFields.name.value.trim(),
    contact: contractorFields.contact.value.trim(),
    phone: contractorFields.phone.value.trim(),
    email: contractorFields.email.value.trim(),
    notes: contractorFields.notes.value.trim(),
  };

  if (!payload.name) {
    throw new Error("Uzupelnij nazwe kontrahenta.");
  }

  const { error } = await supabaseClient
    .from(CONTRACTORS_TABLE)
    .insert(payload);

  if (error) {
    throw new Error(`Blad dodawania kontrahenta: ${error.message}`);
  }

  await fetchContractors();
  renderContractorsTable();
  closeContractorModal();
  setContractorsResult("Kontrahent dodany.", "success");
}

async function refreshData() {
  await fetchRentalOrders();
  await fetchContractors();
  renderContractorsTable();
}

contractorsSearch.addEventListener("input", renderContractorsTable);
openContractorModalButton.addEventListener("click", openContractorModal);
contractorCreateForm.addEventListener("submit", async (event) => {
  try {
    await createContractor(event);
  } catch (error) {
    setContractorsResult(error.message, "error");
  }
});

contractorModal.addEventListener("click", (event) => {
  const action = event.target.getAttribute("data-action");
  if (action === "close-modal") {
    closeContractorModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !contractorModal.classList.contains("hidden")) {
    closeContractorModal();
  }
});

async function init() {
  loadBuildVersion();
  try {
    ensureSupabaseConfigured();
    await detectSettlementColumn();
    await detectContractorsTable();
    renderDataMode();
    await refreshData();
    if (!hasContractorsTable) {
      setContractorsResult("Tabela kontrahentow nie jest jeszcze dostepna. Poczekaj na migracje Supabase.", "error");
    }
  } catch (error) {
    renderDataMode("Dane: blad konfiguracji Supabase");
    setContractorsResult(error.message, "error");
  }
}

init();
