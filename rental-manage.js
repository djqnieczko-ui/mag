const TABLE_NAME = "warehouse_items";
const RENTAL_ORDERS_TABLE = "rental_orders";
const RENTAL_ITEMS_TABLE = "rental_order_items";

const buildVersion = document.getElementById("build-version");
const dataMode = document.getElementById("data-mode");
const ordersStats = document.getElementById("orders-stats");
const ordersSearch = document.getElementById("orders-search");
const ordersStatusFilter = document.getElementById("orders-status-filter");
const ordersBody = document.getElementById("orders-body");
const orderRowTemplate = document.getElementById("order-row-template");
const orderResult = document.getElementById("order-result");

const supabaseUrl = window.APP_CONFIG?.supabaseUrl || "";
const supabaseAnonKey = window.APP_CONFIG?.supabaseAnonKey || "";
const supabaseClient = window.supabase?.createClient(supabaseUrl, supabaseAnonKey);

let rentalOrders = [];
let hasRentalMetricsColumns = true;
let hasSettlementColumn = true;
let hasContractorIdColumn = true;

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

function parseContractorContact(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return { nip: "", street: "", postalCode: "", city: "" };
  }

  const parts = raw.split("|").map((part) => part.trim());
  let nip = "";
  let addressPart = raw;

  if (parts.length > 1) {
    nip = parts[0].replace(/^NIP:\s*/i, "").trim();
    addressPart = parts.slice(1).join(" | ");
  } else if (/^NIP:\s*/i.test(raw)) {
    nip = raw.replace(/^NIP:\s*/i, "").trim();
    addressPart = "";
  }

  let street = "";
  let postalCode = "";
  let city = "";

  if (addressPart) {
    const normalizedAddress = addressPart.replace(/\s+/g, " ").trim();
    const postalAtEnd = normalizedAddress.match(/([0-9]{2}-[0-9]{3})\s+(.+)$/);

    if (postalAtEnd) {
      postalCode = postalAtEnd[1].trim();
      city = postalAtEnd[2].trim();
      street = normalizedAddress
        .slice(0, postalAtEnd.index)
        .replace(/,\s*$/, "")
        .trim();
    } else {
      const commaParts = normalizedAddress.split(",").map((part) => part.trim()).filter(Boolean);
      if (commaParts.length > 1) {
        street = commaParts[0];
        const tail = commaParts.slice(1).join(" ");
        const postalInTail = tail.match(/^([0-9]{2}-[0-9]{3})\s+(.+)$/);
        if (postalInTail) {
          postalCode = postalInTail[1].trim();
          city = postalInTail[2].trim();
        } else {
          city = tail;
        }
      } else {
        street = normalizedAddress;
      }
    }
  }

  const streetPostalMatch = street.match(/^(.*?)[,\s]+([0-9]{2}-[0-9]{3})\s+(.+)$/);
  if (streetPostalMatch && !postalCode) {
    street = streetPostalMatch[1].trim();
    postalCode = streetPostalMatch[2].trim();
    city = streetPostalMatch[3].trim();
  }

  const cityPostalMatch = city.match(/^([0-9]{2}-[0-9]{3})\s*(.*)$/);
  if (cityPostalMatch) {
    if (!postalCode) {
      postalCode = cityPostalMatch[1].trim();
    }
    city = cityPostalMatch[2].trim();
  }

  city = city.replace(/^[,\s-]+/, "").trim();

  return { nip, street, postalCode, city };
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

function fromOrderRow(row) {
  const outstandingQuantity = (row.rental_order_items || []).reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0
  );
  const returnedQuantity = Number(row.returned_quantity ?? 0);
  const borrowedTotalQuantity = Number(
    row.borrowed_total_quantity ?? (outstandingQuantity + returnedQuantity)
  );
  const relation = row.contractor || null;
  const parsedContact = relation
    ? {
        nip: relation.nip || "",
        street: relation.street || "",
        postalCode: relation.postal_code || "",
        city: relation.city || "",
      }
    : parseContractorContact(row.contractor_contact || "");

  return {
    id: row.id,
    contractorName: relation?.name || row.contractor_name || "",
    contractorContact: row.contractor_contact || "",
    contractorPhone: relation?.phone || row.contractor_phone || "",
    contractorEmail: relation?.email || row.contractor_email || "",
    contractorNip: parsedContact.nip || "",
    contractorStreet: parsedContact.street || "",
    contractorPostalCode: parsedContact.postalCode || "",
    contractorCity: parsedContact.city || "",
    declaredReturnDate: row.declared_return_date || "",
    actualReturnDate: row.actual_return_date || "",
    settledAt: row.settled_at || "",
    borrowedTotalQuantity,
    returnedQuantity,
    outstandingQuantity,
    notes: row.notes || "",
    createdAt: row.created_at,
    items: (row.rental_order_items || []).map((item) => ({
      id: item.id,
      orderId: row.id,
      deviceCode: item.device_code,
      department: item.department,
      category: item.category,
      producer: item.producer,
      name: item.name,
      quantity: Number(item.quantity || 0),
    })),
  };
}

async function fetchRentalOrders() {
  const contractorRelation = hasContractorIdColumn
    ? ", contractor:contractors(id, name, nip, street, postal_code, city, phone, email)"
    : "";
  const selectFields = hasRentalMetricsColumns
    ? `id, contractor_name, contractor_contact, contractor_phone, contractor_email, declared_return_date, actual_return_date, ${hasSettlementColumn ? "settled_at, " : ""}borrowed_total_quantity, returned_quantity, notes, created_at, rental_order_items(id, device_code, department, category, producer, name, quantity)${contractorRelation}`
    : `id, contractor_name, contractor_contact, contractor_phone, contractor_email, declared_return_date, actual_return_date, ${hasSettlementColumn ? "settled_at, " : ""}notes, created_at, rental_order_items(id, device_code, department, category, producer, name, quantity)${contractorRelation}`;

  const { data, error } = await supabaseClient
    .from(RENTAL_ORDERS_TABLE)
    .select(selectFields)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Błąd pobierania list wynajmu: ${error.message}`);
  rentalOrders = (data || []).map(fromOrderRow);
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

  throw new Error(`Błąd sprawdzania powiazania kontrahenta: ${error.message}`);
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

  throw new Error(`Błąd sprawdzania kolumn list wynajmu: ${error.message}`);
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

  throw new Error(`Błąd sprawdzania kolumny rozliczenia: ${error.message}`);
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
    return {
      label: "Rozliczono",
      tone: "settled",
      days: null,
    };
  }

  if (order.actualReturnDate) {
    return {
      label: `Zwrocono ${formatDate(order.actualReturnDate)}`,
      tone: "returned",
      days: null,
    };
  }

  if (order.returnedQuantity > 0 && order.outstandingQuantity > 0) {
    return {
      label: `Czesciowy zwrot (${order.returnedQuantity}/${order.borrowedTotalQuantity})`,
      tone: "partial",
      days: null,
    };
  }

  const days = getDaysToReturn(order.declaredReturnDate);
  if (days === null) {
    return { label: "Brak terminu", tone: "neutral", days: null };
  }
  if (days < 0) {
    return { label: "Po terminie", tone: "overdue", days };
  }
  if (days === 0) {
    return { label: "Zwrot dzisiaj", tone: "today", days };
  }
  return { label: "W terminie", tone: "ok", days };
}

function setOrderResult(message = "", tone = "") {
  orderResult.textContent = message;
  orderResult.className = "csv-result";
  if (tone) {
    orderResult.classList.add(tone);
  }
}

function renderOrdersStats(filteredOrders) {
  const openOrders = filteredOrders.filter((order) => !order.actualReturnDate);
  const overdue = openOrders.filter((order) => getOrderStatus(order).tone === "overdue").length;
  const dueToday = openOrders.filter((order) => getOrderStatus(order).tone === "today").length;
  const settled = filteredOrders.filter((order) => Boolean(order.settledAt)).length;
  const returned = filteredOrders.filter((order) => Boolean(order.actualReturnDate) && !order.settledAt).length;

  ordersStats.innerHTML = [
    ["Wszystkie WZ", filteredOrders.length],
    ["Otwarte", openOrders.length],
    ["Po terminie", overdue],
    ["Zwrot dzisiaj", dueToday],
    ["Zwrocone", returned],
    ["Rozliczone", settled],
  ]
    .map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function getFilteredOrders() {
  const query = normalizeText(ordersSearch.value);
  const statusFilter = ordersStatusFilter?.value || "all";
  return rentalOrders.filter((order) => {
    const orderStatus = getOrderStatus(order);
    if (statusFilter !== "all" && orderStatus.tone !== statusFilter) {
      return false;
    }

    const haystack = [
      order.contractorName,
      order.contractorNip,
      order.contractorStreet,
      order.contractorPostalCode,
      order.contractorCity,
      order.contractorPhone,
      order.contractorEmail,
      order.notes,
    ]
      .map(normalizeText)
      .join(" ");
    return haystack.includes(query);
  });
}

function renderOrdersList() {
  const filteredOrders = getFilteredOrders();
  ordersBody.innerHTML = "";

  for (const order of filteredOrders) {
    const row = orderRowTemplate.content.cloneNode(true);
    const tr = row.querySelector("tr");
    const status = getOrderStatus(order);
    const daysLabel = status.days === null ? "-" : status.days < 0 ? `${Math.abs(status.days)} dni po terminie` : `${status.days} dni`;
    const badge = document.createElement("span");
    const openLink = row.querySelector('[data-action="open-order"]');

    badge.className = `status-badge status-${status.tone}`;
    badge.textContent = status.label;

    tr.classList.add(`row-${status.tone}`);
    tr.classList.add("row-clickable");
    tr.addEventListener("click", () => {
      window.location.href = `rental-order.html?id=${encodeURIComponent(order.id)}`;
    });

    row.querySelector('[data-field="createdAt"]').textContent = formatDateTime(order.createdAt);
    row.querySelector('[data-field="contractorName"]').textContent = order.contractorName || "-";
    row.querySelector('[data-field="contractorNip"]').textContent = order.contractorNip || "-";
    row.querySelector('[data-field="contractorStreet"]').textContent = order.contractorStreet || "-";
    row.querySelector('[data-field="contractorPostalCode"]').textContent = order.contractorPostalCode || "-";
    row.querySelector('[data-field="contractorCity"]').textContent = order.contractorCity || "-";
    row.querySelector('[data-field="contractorPhone"]').textContent = order.contractorPhone || "-";
    row.querySelector('[data-field="contractorEmail"]').textContent = order.contractorEmail || "-";
    row.querySelector('[data-field="returnDate"]').textContent = formatDate(order.declaredReturnDate);
    row.querySelector('[data-field="daysToReturn"]').textContent = daysLabel;
    row.querySelector('[data-field="borrowedCount"]').textContent = order.borrowedTotalQuantity;
    row.querySelector('[data-field="returnedCount"]').textContent = order.returnedQuantity;
    row.querySelector('[data-field="status"]').replaceWith(badge);
    openLink.href = `rental-order.html?id=${encodeURIComponent(order.id)}`;
    openLink.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    ordersBody.appendChild(row);
  }

  renderOrdersStats(filteredOrders);
}

async function refreshData() {
  await fetchRentalOrders();
  renderOrdersList();
}

ordersSearch.addEventListener("input", renderOrdersList);
ordersStatusFilter?.addEventListener("change", renderOrdersList);

async function init() {
  loadBuildVersion();
  try {
    ensureSupabaseConfigured();
    await detectContractorIdColumn();
    await detectSettlementColumn();
    await detectRentalMetricsColumns();
    renderDataMode();
    await refreshData();
  } catch (error) {
    renderDataMode("Dane: blad konfiguracji Supabase");
    alert(error.message);
  }
}

init();
