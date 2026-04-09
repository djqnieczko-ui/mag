const RENTAL_ORDERS_TABLE = "rental_orders";
const CONTRACTORS_TABLE = "contractors";

const buildVersion = document.getElementById("build-version");
const dataMode = document.getElementById("data-mode");
const contractorTitle = document.getElementById("contractor-title");
const contractorMeta = document.getElementById("contractor-meta");
const contractorSummary = document.getElementById("contractor-summary");
const contractorContactSummary = document.getElementById("contractor-contact-summary");
const contractorNotesSection = document.getElementById("contractor-notes-section");
const contractorNotes = document.getElementById("contractor-notes");
const contractorOrdersBody = document.getElementById("contractor-orders-body");
const contractorOrdersEmpty = document.getElementById("contractor-orders-empty");
const contractorDetailResult = document.getElementById("contractor-detail-result");

const supabaseUrl = window.APP_CONFIG?.supabaseUrl || "";
const supabaseAnonKey = window.APP_CONFIG?.supabaseAnonKey || "";
const supabaseClient = window.supabase?.createClient(supabaseUrl, supabaseAnonKey);

let hasSettlementColumn = true;
let hasContractorIdColumn = true;
let hasRentalMetricsColumns = true;
let selectedContractor = null;
let relatedOrders = [];

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

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pl-PL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
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

function setDetailResult(message = "", tone = "") {
  contractorDetailResult.textContent = message;
  contractorDetailResult.className = "csv-result";
  if (tone) {
    contractorDetailResult.classList.add(tone);
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

async function detectContractorIdColumn() {
  const { error } = await supabaseClient
    .from(RENTAL_ORDERS_TABLE)
    .select("id, contractor_id")
    .limit(1);

  if (!error) {
    hasContractorIdColumn = true;
    return;
  }

  if (error.code === "42703" || /contractor_id/i.test(error.message)) {
    hasContractorIdColumn = false;
    return;
  }

  throw new Error(`Blad sprawdzania powiazania kontrahenta: ${error.message}`);
}

async function detectRentalMetricsColumns() {
  const { error } = await supabaseClient
    .from(RENTAL_ORDERS_TABLE)
    .select("id, borrowed_total_quantity, returned_quantity")
    .limit(1);

  if (!error) {
    hasRentalMetricsColumns = true;
    return;
  }

  if (error.code === "42703" || /borrowed_total_quantity|returned_quantity/i.test(error.message)) {
    hasRentalMetricsColumns = false;
    return;
  }

  throw new Error(`Blad sprawdzania kolumn metryk WZ: ${error.message}`);
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

function getOrderStatus(order) {
  if (order.settledAt) {
    return { label: "Rozliczono", tone: "settled", days: null };
  }
  if (order.actualReturnDate) {
    return { label: `Zwrocono ${formatDate(order.actualReturnDate)}`, tone: "returned", days: null };
  }
  if (hasRentalMetricsColumns && order.returnedQuantity > 0 && order.outstandingQuantity > 0) {
    return {
      label: `Czesciowy zwrot (${order.returnedQuantity}/${order.borrowedTotalQuantity})`,
      tone: "partial",
      days: null,
    };
  }

  const days = getDaysToReturn(order.declaredReturnDate);
  if (days === null) return { label: "Brak terminu", tone: "neutral", days: null };
  if (days < 0) return { label: "Po terminie", tone: "overdue", days };
  if (days === 0) return { label: "Zwrot dzisiaj", tone: "today", days };
  return { label: "W terminie", tone: "ok", days };
}

function mapOrderRow(row) {
  const borrowedTotalQuantity = Number(row.borrowed_total_quantity ?? 0);
  const returnedQuantity = Number(row.returned_quantity ?? 0);
  return {
    id: row.id,
    declaredReturnDate: row.declared_return_date || "",
    actualReturnDate: row.actual_return_date || "",
    settledAt: row.settled_at || "",
    borrowedTotalQuantity,
    returnedQuantity,
    outstandingQuantity: Math.max(0, borrowedTotalQuantity - returnedQuantity),
    createdAt: row.created_at,
  };
}

async function fetchContractorContext() {
  const params = new URLSearchParams(window.location.search);
  const contractorId = params.get("id");
  const contractorName = (params.get("name") || "").trim();

  if (!contractorId && !contractorName) {
    throw new Error("Brak identyfikatora kontrahenta.");
  }

  if (contractorId) {
    const { data, error } = await supabaseClient
      .from(CONTRACTORS_TABLE)
      .select("id, name, nip, street, postal_code, city, phone, email, notes, created_at")
      .eq("id", contractorId)
      .single();

    if (error) {
      throw new Error(`Blad pobierania kontrahenta: ${error.message}`);
    }

    selectedContractor = data;
    return;
  }

  selectedContractor = {
    id: null,
    name: contractorName,
    nip: "",
    street: "",
    postal_code: "",
    city: "",
    phone: "",
    email: "",
    notes: "",
    created_at: null,
  };
}

async function fetchRelatedOrders() {
  const selectFields = hasRentalMetricsColumns
    ? `id, contractor_id, contractor_name, declared_return_date, actual_return_date, ${hasSettlementColumn ? "settled_at, " : ""}borrowed_total_quantity, returned_quantity, created_at`
    : `id, contractor_id, contractor_name, declared_return_date, actual_return_date, ${hasSettlementColumn ? "settled_at, " : ""}created_at`;

  const orders = [];
  const seenIds = new Set();

  if (hasContractorIdColumn && selectedContractor.id) {
    const { data, error } = await supabaseClient
      .from(RENTAL_ORDERS_TABLE)
      .select(selectFields)
      .eq("contractor_id", selectedContractor.id)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Blad pobierania WZ po ID kontrahenta: ${error.message}`);
    }

    for (const row of data || []) {
      if (!seenIds.has(row.id)) {
        orders.push(mapOrderRow(row));
        seenIds.add(row.id);
      }
    }
  }

  if (selectedContractor.name) {
    let query = supabaseClient
      .from(RENTAL_ORDERS_TABLE)
      .select(selectFields)
      .eq("contractor_name", selectedContractor.name)
      .order("created_at", { ascending: false });

    if (hasContractorIdColumn && selectedContractor.id) {
      query = query.is("contractor_id", null);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Blad pobierania WZ po nazwie kontrahenta: ${error.message}`);
    }

    for (const row of data || []) {
      if (!seenIds.has(row.id)) {
        orders.push(mapOrderRow(row));
        seenIds.add(row.id);
      }
    }
  }

  relatedOrders = orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function renderContractorSummary() {
  const returnedCount = relatedOrders.filter((order) => Boolean(order.actualReturnDate)).length;
  const overdueCount = relatedOrders.filter((order) => getOrderStatus(order).tone === "overdue").length;
  const inProgressCount = relatedOrders.filter((order) => !order.actualReturnDate && getOrderStatus(order).tone !== "overdue").length;

  contractorTitle.textContent = selectedContractor.name || "Nieznany kontrahent";
  contractorMeta.textContent = selectedContractor.created_at
    ? `ID: ${selectedContractor.id || "brak"} • Dodano: ${formatDateTime(selectedContractor.created_at)}`
    : `ID: ${selectedContractor.id || "brak"} • Rekord zbudowany na podstawie dokumentow WZ`;

  contractorSummary.innerHTML = [
    ["NIP", selectedContractor.nip || "-"],
    ["Ulica", selectedContractor.street || "-"],
    ["Kod pocztowy", selectedContractor.postal_code || "-"],
    ["Miejscowosc", selectedContractor.city || "-"],
  ]
    .map(([label, value]) => `<div class="detail-chip"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");

  contractorContactSummary.innerHTML = [
    ["Telefon", selectedContractor.phone || "-"],
    ["Email", selectedContractor.email || "-"],
    ["WZ", `${relatedOrders.length}/${returnedCount}/${inProgressCount}/${overdueCount}`],
  ]
    .map(([label, value]) => `<div class="detail-chip"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");

  if (selectedContractor.notes) {
    contractorNotesSection.style.display = "block";
    contractorNotes.textContent = selectedContractor.notes;
  } else {
    contractorNotesSection.style.display = "none";
    contractorNotes.textContent = "-";
  }
}

function renderRelatedOrders() {
  contractorOrdersBody.innerHTML = "";
  contractorOrdersEmpty.style.display = relatedOrders.length ? "none" : "block";

  for (const order of relatedOrders) {
    const status = getOrderStatus(order);
    const row = document.createElement("tr");
    row.className = `row-${status.tone}`;

    const createdAtCell = document.createElement("td");
    createdAtCell.textContent = formatDateTime(order.createdAt);

    const returnDateCell = document.createElement("td");
    returnDateCell.textContent = formatDate(order.declaredReturnDate);

    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `status-badge status-${status.tone}`;
    badge.textContent = status.label;
    statusCell.appendChild(badge);

    const borrowedCell = document.createElement("td");
    borrowedCell.textContent = String(order.borrowedTotalQuantity || 0);

    const returnedCell = document.createElement("td");
    returnedCell.textContent = String(order.returnedQuantity || 0);

    const actionCell = document.createElement("td");
    const openLink = document.createElement("a");
    openLink.href = `rental-order.html?id=${encodeURIComponent(order.id)}`;
    openLink.className = "btn btn-light btn-link";
    openLink.textContent = "Otworz WZ";
    actionCell.appendChild(openLink);

    row.appendChild(createdAtCell);
    row.appendChild(returnDateCell);
    row.appendChild(statusCell);
    row.appendChild(borrowedCell);
    row.appendChild(returnedCell);
    row.appendChild(actionCell);
    contractorOrdersBody.appendChild(row);
  }
}

async function init() {
  loadBuildVersion();
  try {
    ensureSupabaseConfigured();
    await detectSettlementColumn();
    await detectContractorIdColumn();
    await detectRentalMetricsColumns();
    renderDataMode();
    await fetchContractorContext();
    await fetchRelatedOrders();
    renderContractorSummary();
    renderRelatedOrders();
  } catch (error) {
    renderDataMode("Dane: blad konfiguracji Supabase");
    setDetailResult(error.message, "error");
  }
}

init();