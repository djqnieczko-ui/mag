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
const contractorModalTitle = document.getElementById("contractor-modal-title");
const contractorSubmitButton = document.getElementById("contractor-submit-button");
const editContractorId = document.getElementById("edit-contractor-id");

const contractorFields = {
  name: document.getElementById("new-contractor-name"),
  nip: document.getElementById("new-contractor-nip"),
  street: document.getElementById("new-contractor-street"),
  postalCode: document.getElementById("new-contractor-postal-code"),
  city: document.getElementById("new-contractor-city"),
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
let editingContractorId = null;

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function buildContractorContactFromPayload(payload) {
  const nip = String(payload.nip || "").trim();
  const street = String(payload.street || "").trim();
  const postalCode = String(payload.postal_code || "").trim();
  const city = String(payload.city || "").trim();

  const cityLine = [postalCode, city].filter(Boolean).join(" ");
  const address = [street, cityLine].filter(Boolean).join(", ");

  if (nip && address) {
    return `NIP: ${nip} | ${address}`;
  }
  if (nip) {
    return `NIP: ${nip}`;
  }
  return address;
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

async function copyToClipboard(value) {
  const text = String(value ?? "");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const temp = document.createElement("textarea");
  temp.value = text;
  temp.setAttribute("readonly", "");
  temp.style.position = "absolute";
  temp.style.left = "-9999px";
  document.body.appendChild(temp);
  temp.select();
  document.execCommand("copy");
  document.body.removeChild(temp);
}

function setCopyCell(row, fieldName, rawValue) {
  const cell = row.querySelector(`[data-field="${fieldName}"]`);
  if (!cell) return;

  const displayValue = rawValue || "-";
  cell.innerHTML = "";

  const valueSpan = document.createElement("span");
  valueSpan.className = "cell-copy-value";
  valueSpan.textContent = displayValue;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-light cell-copy-btn";
  button.textContent = "Kopiuj";
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await copyToClipboard(displayValue);
      setContractorsResult("Skopiowano do schowka.", "success");
    } catch {
      setContractorsResult("Nie udalo sie skopiowac do schowka.", "error");
    }
  });

  cell.appendChild(valueSpan);
  cell.appendChild(button);
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
    .select("*")
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
      nip: contractor.nip || "",
      street: contractor.street || "",
      postalCode: contractor.postal_code || "",
      city: contractor.city || "",
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
        nip: "",
        street: "",
        postalCode: "",
        city: "",
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
    const haystack = [row.name, row.nip, row.street, row.postalCode, row.city, row.phone, row.email]
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
    setCopyCell(row, "name", rowData.name);
    setCopyCell(row, "nip", rowData.nip || "-");
    setCopyCell(row, "street", rowData.street || "-");
    setCopyCell(row, "postalCode", rowData.postalCode || "-");
    setCopyCell(row, "city", rowData.city || "-");
    setCopyCell(row, "phone", rowData.phone || "-");
    setCopyCell(row, "email", rowData.email || "-");
    setCopyCell(row, "wzSummary", `${rowData.allCount}/${rowData.returnedCount}/${rowData.inProgressCount}/${rowData.overdueCount}`);

    const actionsCell = row.querySelector('[data-field="actions"]');
    if (actionsCell) {
      if (rowData.id) {
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "btn btn-light";
        editButton.textContent = "Edytuj";
        editButton.addEventListener("click", () => {
          openContractorModal("edit", rowData.id);
        });
        actionsCell.appendChild(editButton);
      } else {
        actionsCell.textContent = "-";
      }
    }

    contractorsBody.appendChild(row);
  }

  renderStats(rows);
}

function setContractorModalMode(mode) {
  const isEdit = mode === "edit";
  contractorModalTitle.textContent = isEdit ? "Edytuj kontrahenta" : "Dodaj kontrahenta";
  contractorSubmitButton.textContent = isEdit ? "Zapisz" : "Dodaj";
}

function openContractorModal(mode = "create", contractorId = null) {
  editingContractorId = mode === "edit" ? contractorId : null;
  editContractorId.value = editingContractorId || "";
  setContractorModalMode(mode);

  if (mode === "edit" && contractorId) {
    const contractor = contractors.find((item) => item.id === contractorId);
    if (contractor) {
      contractorFields.name.value = contractor.name || "";
      contractorFields.nip.value = contractor.nip || "";
      contractorFields.street.value = contractor.street || "";
      contractorFields.postalCode.value = contractor.postal_code || "";
      contractorFields.city.value = contractor.city || "";
      contractorFields.phone.value = contractor.phone || "";
      contractorFields.email.value = contractor.email || "";
      contractorFields.notes.value = contractor.notes || "";
    }
  } else {
    contractorCreateForm.reset();
  }

  contractorModal.classList.remove("hidden");
  contractorFields.name.focus();
}

function closeContractorModal() {
  contractorModal.classList.add("hidden");
  contractorCreateForm.reset();
  editContractorId.value = "";
  editingContractorId = null;
  setContractorModalMode("create");
}

async function saveContractor(event) {
  event.preventDefault();
  setContractorsResult();

  if (!hasContractorsTable) {
    throw new Error("Tabela kontrahentow nie jest jeszcze dostepna. Poczekaj na migracje Supabase.");
  }

  const payload = {
    name: contractorFields.name.value.trim(),
    nip: contractorFields.nip.value.trim(),
    street: contractorFields.street.value.trim(),
    postal_code: contractorFields.postalCode.value.trim(),
    city: contractorFields.city.value.trim(),
    phone: contractorFields.phone.value.trim(),
    email: contractorFields.email.value.trim(),
    notes: contractorFields.notes.value.trim(),
  };

  if (!payload.name) {
    throw new Error("Uzupelnij nazwe firmy.");
  }
  if (!payload.nip) {
    throw new Error("Uzupelnij NIP.");
  }
  if (!payload.street) {
    throw new Error("Uzupelnij ulice.");
  }
  if (!payload.postal_code) {
    throw new Error("Uzupelnij kod pocztowy.");
  }
  if (!payload.city) {
    throw new Error("Uzupelnij miejscowosc.");
  }
  if (!payload.phone) {
    throw new Error("Uzupelnij telefon.");
  }
  if (!payload.email) {
    throw new Error("Uzupelnij email.");
  }

  const action = editingContractorId ? "update" : "insert";
  const currentContractor = editingContractorId
    ? contractors.find((item) => item.id === editingContractorId) || null
    : null;
  const previousContractorName = currentContractor?.name || "";
  let error = null;

  if (action === "update") {
    ({ error } = await supabaseClient
      .from(CONTRACTORS_TABLE)
      .update(payload)
      .eq("id", editingContractorId));
  } else {
    ({ error } = await supabaseClient
      .from(CONTRACTORS_TABLE)
      .insert(payload));
  }

  if (error) {
    throw new Error(`Blad zapisu kontrahenta: ${error.message}`);
  }

  if (action === "update") {
    const orderPayload = {
      contractor_name: payload.name,
      contractor_contact: buildContractorContactFromPayload(payload),
      contractor_phone: payload.phone,
      contractor_email: payload.email,
    };

    const { error: orderUpdateError } = await supabaseClient
      .from(RENTAL_ORDERS_TABLE)
      .update(orderPayload)
      .eq("contractor_name", previousContractorName);

    if (orderUpdateError) {
      throw new Error(`Kontrahent zapisany, ale nie udalo sie zaktualizowac WZ: ${orderUpdateError.message}`);
    }
  }

  await fetchContractors();
  renderContractorsTable();
  closeContractorModal();
  setContractorsResult(
    action === "update" ? "Kontrahent zaktualizowany." : "Kontrahent dodany.",
    "success"
  );
}

async function refreshData() {
  await fetchRentalOrders();
  await fetchContractors();
  renderContractorsTable();
}

contractorsSearch.addEventListener("input", renderContractorsTable);
openContractorModalButton.addEventListener("click", () => openContractorModal("create"));
contractorCreateForm.addEventListener("submit", async (event) => {
  try {
    await saveContractor(event);
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
