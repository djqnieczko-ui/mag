const TABLE_NAME = "warehouse_items";
const RENTAL_ORDERS_TABLE = "rental_orders";
const RENTAL_ITEMS_TABLE = "rental_order_items";

const buildVersion = document.getElementById("build-version");
const dataMode = document.getElementById("data-mode");
const selectedOrderMeta = document.getElementById("selected-order-meta");
const selectedOrderStatus = document.getElementById("selected-order-status");
const selectedOrderSummary = document.getElementById("selected-order-summary");
const orderResult = document.getElementById("order-result");
const deleteOrderButton = document.getElementById("delete-order");
const saveOrderChangesButton = document.getElementById("save-order-changes");
const receiveReturnButton = document.getElementById("receive-return");
const selectedItemsBody = document.getElementById("selected-items-body");
const selectedItemsEmpty = document.getElementById("selected-items-empty");
const selectedItemRowTemplate = document.getElementById("selected-item-row-template");
const selectedItemsActionsHeader = document.querySelector('[data-field="actionsHeader"]');
const inventoryAddSearch = document.getElementById("inventory-add-search");
const inventoryAddBody = document.getElementById("inventory-add-body");
const inventoryAddRowTemplate = document.getElementById("inventory-add-row-template");
const addItemsCard = document.querySelector(".add-items-card");

const orderFields = {
  contractorName: document.getElementById("edit-contractor-name"),
  contractorContact: document.getElementById("edit-contractor-contact"),
  contractorPhone: document.getElementById("edit-contractor-phone"),
  contractorEmail: document.getElementById("edit-contractor-email"),
  declaredReturnDate: document.getElementById("edit-declared-return-date"),
  actualReturnDate: document.getElementById("edit-actual-return-date"),
  notes: document.getElementById("edit-contractor-notes"),
};

const supabaseUrl = window.APP_CONFIG?.supabaseUrl || "";
const supabaseAnonKey = window.APP_CONFIG?.supabaseAnonKey || "";
const supabaseClient = window.supabase?.createClient(supabaseUrl, supabaseAnonKey);

let hasSplitStockColumns = true;
let hasRentalMetricsColumns = true;
let hasRentalItemReturnColumns = true;
let hasSettlementColumn = true;
let inventoryItems = [];
let rentalOrders = [];
let selectedOrderId = null;
let selectedDraftItems = [];
let returnDraftQuantities = new Map();

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

async function detectWarehouseStockColumns() {
  const { error } = await supabaseClient
    .from(TABLE_NAME)
    .select("device_code, total_quantity, current_quantity")
    .limit(1);

  if (!error) {
    hasSplitStockColumns = true;
    return;
  }

  if (error.code === "42703" || /total_quantity|current_quantity/i.test(error.message)) {
    hasSplitStockColumns = false;
    return;
  }

  throw new Error(`Błąd sprawdzania schematu magazynu: ${error.message}`);
}

function fromInventoryRow(row) {
  return {
    department: row.department,
    category: row.category,
    producer: row.producer,
    name: row.name,
    totalQuantity: Number(row.total_quantity ?? row.quantity ?? 0),
    currentQuantity: Number(row.current_quantity ?? row.quantity ?? 0),
    deviceCode: row.device_code,
  };
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

  return {
    id: row.id,
    contractorName: row.contractor_name || "",
    contractorContact: row.contractor_contact || "",
    contractorPhone: row.contractor_phone || "",
    contractorEmail: row.contractor_email || "",
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
      borrowedQuantity: Number(item.borrowed_quantity ?? item.quantity ?? 0),
      returnedQuantity: Number(item.returned_quantity ?? 0),
    })),
  };
}

async function fetchInventory() {
  const selectFields = hasSplitStockColumns
    ? "device_code, department, category, producer, name, quantity, total_quantity, current_quantity"
    : "device_code, department, category, producer, name, quantity";

  const { data, error } = await supabaseClient
    .from(TABLE_NAME)
    .select(selectFields)
    .order("name", { ascending: true });

  if (error) throw new Error(`Błąd pobierania magazynu: ${error.message}`);
  inventoryItems = (data || []).map(fromInventoryRow);
}

async function fetchRentalOrders() {
  const itemSelectFields = hasRentalItemReturnColumns
    ? "id, device_code, department, category, producer, name, quantity, borrowed_quantity, returned_quantity"
    : "id, device_code, department, category, producer, name, quantity";

  const selectFields = hasRentalMetricsColumns
    ? `id, contractor_name, contractor_contact, contractor_phone, contractor_email, declared_return_date, actual_return_date, ${hasSettlementColumn ? "settled_at, " : ""}borrowed_total_quantity, returned_quantity, notes, created_at, rental_order_items(${itemSelectFields})`
    : `id, contractor_name, contractor_contact, contractor_phone, contractor_email, declared_return_date, actual_return_date, ${hasSettlementColumn ? "settled_at, " : ""}notes, created_at, rental_order_items(${itemSelectFields})`;

  const { data, error } = await supabaseClient
    .from(RENTAL_ORDERS_TABLE)
    .select(selectFields)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Błąd pobierania list wynajmu: ${error.message}`);
  rentalOrders = (data || []).map(fromOrderRow);
}

async function detectRentalItemReturnColumns() {
  const { error } = await supabaseClient
    .from(RENTAL_ITEMS_TABLE)
    .select("id, borrowed_quantity, returned_quantity")
    .limit(1);

  if (!error) {
    hasRentalItemReturnColumns = true;
    return;
  }

  if (error.code === "42703" || /borrowed_quantity|returned_quantity/i.test(error.message)) {
    hasRentalItemReturnColumns = false;
    return;
  }

  throw new Error(`Błąd sprawdzania kolumn pozycji WZ: ${error.message}`);
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

function getSelectedOrder() {
  return rentalOrders.find((order) => order.id === selectedOrderId) || null;
}

function getOriginalQuantityMap(order = getSelectedOrder()) {
  const quantityMap = new Map();
  if (!order) return quantityMap;
  for (const item of order.items) {
    quantityMap.set(item.deviceCode, item.quantity);
  }
  return quantityMap;
}

function getDraftQuantityMap() {
  const quantityMap = new Map();
  for (const item of selectedDraftItems) {
    quantityMap.set(item.deviceCode, item.quantity);
  }
  return quantityMap;
}

function getInventoryItem(deviceCode) {
  return inventoryItems.find((item) => item.deviceCode === deviceCode) || null;
}

function getEditableLimit(deviceCode) {
  const originalQuantity = getOriginalQuantityMap().get(deviceCode) || 0;
  const inventoryItem = getInventoryItem(deviceCode);
  const currentQuantity = inventoryItem ? inventoryItem.currentQuantity : 0;
  return currentQuantity + originalQuantity;
}

function buildDraftFromOrder(order) {
  selectedDraftItems = order.items.map((item) => ({ ...item }));
}

function buildReturnDraftFromOrder(order) {
  returnDraftQuantities = new Map();
  for (const item of order.items) {
    returnDraftQuantities.set(item.id, item.quantity);
  }
}

function setOrderResult(message = "", tone = "") {
  orderResult.textContent = message;
  orderResult.className = "csv-result";
  if (tone) {
    orderResult.classList.add(tone);
  }
}

function renderSelectedOrderHeader(order) {
  if (!order) {
    selectedOrderMeta.textContent = "Nie znaleziono dokumentu WZ.";
    selectedOrderStatus.textContent = "Brak dokumentu";
    selectedOrderStatus.className = "status-badge status-neutral";
    selectedOrderSummary.innerHTML = "";
    return;
  }

  const status = getOrderStatus(order);
  const totalItems = selectedDraftItems.reduce((sum, item) => sum + item.quantity, 0);
  const borrowedTotal = Number(order.borrowedTotalQuantity || totalItems);
  const returnedTotal = Number(order.returnedQuantity || 0);
  const missingTotal = Math.max(0, borrowedTotal - returnedTotal);
  const days = status.days === null ? "-" : status.days;

  selectedOrderMeta.textContent = `Dokument z ${formatDateTime(order.createdAt)} • ID: ${order.id}`;
  selectedOrderStatus.textContent = status.label;
  selectedOrderStatus.className = `status-badge status-${status.tone}`;
  selectedOrderSummary.innerHTML = [
    ["Pozostalo na WZ", totalItems],
    ["Wypozyczono", borrowedTotal],
    ["Zwrocono", returnedTotal],
    ["Braki", missingTotal],
    ["Dni do zwrotu", days],
    ["Faktyczny zwrot", order.actualReturnDate ? formatDate(order.actualReturnDate) : "brak"],
  ]
    .map(([label, value]) => `<div class="detail-chip"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function toggleOrderActions(order) {
  const isSelected = Boolean(order);
  const isReturned = Boolean(order?.actualReturnDate);
  const isSettled = Boolean(order?.settledAt);
  deleteOrderButton.disabled = !isSelected;
  saveOrderChangesButton.disabled = !isSelected || isReturned || isSettled;
  receiveReturnButton.disabled = !isSelected || isSettled;
  receiveReturnButton.textContent = isReturned ? "Rozliczono" : "Przyjmij zwrot";
  inventoryAddSearch.disabled = !isSelected || isReturned || isSettled;

  if (selectedItemsActionsHeader) {
    selectedItemsActionsHeader.style.display = isReturned || isSettled ? "none" : "";
  }
  if (addItemsCard) {
    addItemsCard.style.display = isSelected && (isReturned || isSettled) ? "none" : "";
  }

  for (const field of Object.values(orderFields)) {
    field.disabled = !isSelected || field === orderFields.actualReturnDate;
  }
  orderFields.actualReturnDate.disabled = true;
}

function renderSelectedItems() {
  selectedItemsBody.innerHTML = "";
  const order = getSelectedOrder();
  const isReturned = Boolean(order?.actualReturnDate);
  selectedItemsEmpty.style.display = selectedDraftItems.length ? "none" : "block";

  for (const item of selectedDraftItems) {
    const row = selectedItemRowTemplate.content.cloneNode(true);
    const limit = getEditableLimit(item.deviceCode);
    row.querySelector('[data-field="department"]').textContent = item.department;
    row.querySelector('[data-field="category"]').textContent = item.category;
    row.querySelector('[data-field="producer"]').textContent = item.producer;
    row.querySelector('[data-field="name"]').textContent = item.name;
    row.querySelector('[data-field="deviceCode"]').textContent = item.deviceCode;
    row.querySelector('[data-field="borrowedQuantity"]').textContent = item.borrowedQuantity;
    row.querySelector('[data-field="returnedQuantity"]').textContent = item.returnedQuantity;
    row.querySelector('[data-field="maxQuantity"]').textContent = limit;

    const quantityInput = row.querySelector('[data-field="quantity"]');
    quantityInput.value = item.quantity;
    quantityInput.max = String(limit);
    quantityInput.disabled = isReturned;
    quantityInput.addEventListener("input", () => {
      const nextValue = Number(quantityInput.value);
      if (!Number.isInteger(nextValue) || nextValue < 1) {
        quantityInput.value = String(item.quantity);
        return;
      }
      item.quantity = Math.min(nextValue, limit);
      quantityInput.value = String(item.quantity);
      item.borrowedQuantity = Number(item.returnedQuantity || 0) + item.quantity;
      row.querySelector('[data-field="borrowedQuantity"]').textContent = item.borrowedQuantity;
      renderSelectedOrderHeader(getSelectedOrder());
      renderInventoryAddList();
    });

    const partialReturnQuantityInput = row.querySelector('[data-field="partialReturnQuantity"]');
    const savedOrderItem = order?.items.find((entry) => entry.id === item.id) || null;
    const returnLimit = Number(savedOrderItem?.quantity ?? item.quantity);
    const currentReturnDraft = Number(returnDraftQuantities.get(item.id));
    const safeReturnDraft = Number.isInteger(currentReturnDraft)
      ? Math.min(Math.max(currentReturnDraft, 0), returnLimit)
      : returnLimit;
    partialReturnQuantityInput.value = String(safeReturnDraft);
    partialReturnQuantityInput.max = String(returnLimit);
    partialReturnQuantityInput.disabled = isReturned || !item.id;

    partialReturnQuantityInput.addEventListener("input", () => {
      const nextValue = Number(partialReturnQuantityInput.value);
      if (!Number.isInteger(nextValue) || nextValue < 0) {
        partialReturnQuantityInput.value = String(safeReturnDraft);
        return;
      }
      const clampedValue = Math.min(nextValue, returnLimit);
      partialReturnQuantityInput.value = String(clampedValue);
      if (item.id) {
        returnDraftQuantities.set(item.id, clampedValue);
      }
    });

    const removeButton = row.querySelector('[data-action="remove-item"]');
    const actionsCell = row.querySelector('[data-field="actionsCell"]');
    if (actionsCell) {
      actionsCell.style.display = isReturned || Boolean(order?.settledAt) ? "none" : "";
    }
    removeButton.disabled = isReturned;
    removeButton.addEventListener("click", () => {
      selectedDraftItems = selectedDraftItems.filter((entry) => entry.deviceCode !== item.deviceCode);
      renderSelectedItems();
      renderSelectedOrderHeader(getSelectedOrder());
      renderInventoryAddList();
    });

    selectedItemsBody.appendChild(row);
  }
}

function getAvailableToAdd(deviceCode) {
  const inventoryItem = getInventoryItem(deviceCode);
  if (!inventoryItem) return 0;
  const originalQuantity = getOriginalQuantityMap().get(deviceCode) || 0;
  const draftQuantity = getDraftQuantityMap().get(deviceCode) || 0;
  return inventoryItem.currentQuantity + originalQuantity - draftQuantity;
}

function getFilteredInventoryForAdd() {
  const query = normalizeText(inventoryAddSearch.value);
  return inventoryItems.filter((item) => {
    const haystack = [item.department, item.category, item.producer, item.name, item.deviceCode]
      .map(normalizeText)
      .join(" ");
    return haystack.includes(query);
  });
}

function renderInventoryAddList() {
  inventoryAddBody.innerHTML = "";
  const order = getSelectedOrder();
  const isReturned = Boolean(order?.actualReturnDate);
  const filteredInventory = getFilteredInventoryForAdd();

  for (const item of filteredInventory) {
    const availableToAdd = getAvailableToAdd(item.deviceCode);
    const row = inventoryAddRowTemplate.content.cloneNode(true);
    row.querySelector('[data-field="department"]').textContent = item.department;
    row.querySelector('[data-field="category"]').textContent = item.category;
    row.querySelector('[data-field="producer"]').textContent = item.producer;
    row.querySelector('[data-field="name"]').textContent = item.name;
    row.querySelector('[data-field="currentQuantity"]').textContent = item.currentQuantity;
    row.querySelector('[data-field="availableToAdd"]').textContent = availableToAdd;
    row.querySelector('[data-field="deviceCode"]').textContent = item.deviceCode;

    const addButton = row.querySelector('[data-action="add-item"]');
    addButton.disabled = !order || isReturned || availableToAdd <= 0;
    addButton.addEventListener("click", () => addItemToSelectedOrder(item));

    inventoryAddBody.appendChild(row);
  }
}

function fillSelectedOrderForm(order) {
  if (!order) {
    for (const field of Object.values(orderFields)) {
      field.value = "";
    }
    return;
  }

  orderFields.contractorName.value = order.contractorName;
  orderFields.contractorContact.value = order.contractorContact;
  orderFields.contractorPhone.value = order.contractorPhone;
  orderFields.contractorEmail.value = order.contractorEmail;
  orderFields.declaredReturnDate.value = order.declaredReturnDate;
  orderFields.actualReturnDate.value = order.actualReturnDate;
  orderFields.notes.value = order.notes;
}

function selectOrder(orderId) {
  const order = rentalOrders.find((entry) => entry.id === orderId) || null;
  selectedOrderId = order?.id || null;
  buildDraftFromOrder(order || { items: [] });
  buildReturnDraftFromOrder(order || { items: [] });
  fillSelectedOrderForm(order);
  renderSelectedOrderHeader(order);
  renderSelectedItems();
  renderInventoryAddList();
  toggleOrderActions(order);
  setOrderResult();
}

function addItemToSelectedOrder(item) {
  const availableToAdd = getAvailableToAdd(item.deviceCode);
  if (availableToAdd <= 0) {
    setOrderResult(`Brak dostepnej ilosci do dodania dla ${item.name}.`, "error");
    return;
  }

  const existing = selectedDraftItems.find((entry) => entry.deviceCode === item.deviceCode);
  if (existing) {
    existing.quantity = Math.min(existing.quantity + 1, getEditableLimit(item.deviceCode));
    existing.borrowedQuantity = Number(existing.returnedQuantity || 0) + existing.quantity;
  } else {
    selectedDraftItems.push({
      deviceCode: item.deviceCode,
      department: item.department,
      category: item.category,
      producer: item.producer,
      name: item.name,
      quantity: 1,
      borrowedQuantity: 1,
      returnedQuantity: 0,
    });
  }

  renderSelectedItems();
  renderSelectedOrderHeader(getSelectedOrder());
  renderInventoryAddList();
  setOrderResult();
}

function getOrderUpdatePayload() {
  return {
    contractor_name: orderFields.contractorName.value.trim(),
    contractor_contact: orderFields.contractorContact.value.trim(),
    contractor_phone: orderFields.contractorPhone.value.trim(),
    contractor_email: orderFields.contractorEmail.value.trim(),
    declared_return_date: orderFields.declaredReturnDate.value || null,
    notes: orderFields.notes.value.trim(),
  };
}

function validateSelectedOrder(order) {
  if (!order) {
    throw new Error("Wybierz listę wynajmu.");
  }
  if (order.actualReturnDate) {
    throw new Error("Nie mozna edytowac zwroconego WZ.");
  }

  const payload = getOrderUpdatePayload();
  if (!payload.contractor_name) {
    throw new Error("Uzupelnij nazwe firmy.");
  }
  if (!payload.declared_return_date) {
    throw new Error("Uzupelnij deklarowana date zwrotu.");
  }
  if (!selectedDraftItems.length) {
    throw new Error("Lista WZ musi zawierac co najmniej jedna pozycje.");
  }

  const draftOutstanding = selectedDraftItems.reduce((sum, item) => sum + item.quantity, 0);
  if (hasRentalMetricsColumns && draftOutstanding < Number(order.returnedQuantity || 0)) {
    throw new Error("Pozostala ilosc na WZ nie moze byc mniejsza niz juz zwrocona ilosc.");
  }

  for (const item of selectedDraftItems) {
    const limit = getEditableLimit(item.deviceCode);
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new Error(`Niepoprawna ilosc dla ${item.name}.`);
    }
    if (item.quantity > limit) {
      throw new Error(`Za duza ilosc dla ${item.name}. Maksymalnie: ${limit}.`);
    }
  }

  return payload;
}

function getInventoryAdjustments(order) {
  const originalMap = getOriginalQuantityMap(order);
  const newMap = getDraftQuantityMap();
  const deviceCodes = new Set([...originalMap.keys(), ...newMap.keys()]);
  const adjustments = [];

  for (const deviceCode of deviceCodes) {
    const inventoryItem = getInventoryItem(deviceCode);
    if (!inventoryItem) {
      throw new Error(`Brak pozycji magazynowej dla kodu ${deviceCode}.`);
    }

    const oldQuantity = originalMap.get(deviceCode) || 0;
    const newQuantity = newMap.get(deviceCode) || 0;
    const delta = newQuantity - oldQuantity;
    if (!delta) continue;

    if (delta > 0 && inventoryItem.currentQuantity < delta) {
      throw new Error(`Brak dostepnej ilosci dla ${deviceCode}. Dostepne: ${inventoryItem.currentQuantity}.`);
    }

    const nextCurrentQuantity = delta > 0
      ? inventoryItem.currentQuantity - delta
      : Math.min(inventoryItem.totalQuantity, inventoryItem.currentQuantity + Math.abs(delta));

    adjustments.push({
      deviceCode,
      previousCurrentQuantity: inventoryItem.currentQuantity,
      nextCurrentQuantity,
    });
  }

  return adjustments;
}

async function applyInventoryAdjustment(adjustment) {
  const payload = hasSplitStockColumns
    ? { current_quantity: adjustment.nextCurrentQuantity, quantity: adjustment.nextCurrentQuantity }
    : { quantity: adjustment.nextCurrentQuantity };

  const { error } = await supabaseClient
    .from(TABLE_NAME)
    .update(payload)
    .eq("device_code", adjustment.deviceCode);

  if (error) {
    throw new Error(`Blad aktualizacji magazynu dla ${adjustment.deviceCode}: ${error.message}`);
  }
}

async function rollbackInventoryAdjustments(adjustments) {
  for (const adjustment of adjustments) {
    const payload = hasSplitStockColumns
      ? { current_quantity: adjustment.previousCurrentQuantity, quantity: adjustment.previousCurrentQuantity }
      : { quantity: adjustment.previousCurrentQuantity };

    await supabaseClient
      .from(TABLE_NAME)
      .update(payload)
      .eq("device_code", adjustment.deviceCode);
  }
}

function buildDraftInsertPayload(orderId) {
  return selectedDraftItems.map((item) => ({
    order_id: orderId,
    device_code: item.deviceCode,
    department: item.department,
    category: item.category,
    producer: item.producer,
    name: item.name,
    quantity: item.quantity,
    ...(hasRentalItemReturnColumns
      ? {
          borrowed_quantity: Number(item.returnedQuantity || 0) + Number(item.quantity || 0),
          returned_quantity: Number(item.returnedQuantity || 0),
        }
      : {}),
  }));
}

function buildOriginalInsertPayload(order) {
  return order.items.map((item) => ({
    order_id: order.id,
    device_code: item.deviceCode,
    department: item.department,
    category: item.category,
    producer: item.producer,
    name: item.name,
    quantity: item.quantity,
    ...(hasRentalItemReturnColumns
      ? {
          borrowed_quantity: Number(item.borrowedQuantity || item.quantity || 0),
          returned_quantity: Number(item.returnedQuantity || 0),
        }
      : {}),
  }));
}

async function saveSelectedOrderChanges() {
  const order = getSelectedOrder();
  const updatePayload = validateSelectedOrder(order);
  const draftOutstanding = selectedDraftItems.reduce((sum, item) => sum + item.quantity, 0);
  const nextBorrowedTotal = hasRentalMetricsColumns
    ? Number(order.returnedQuantity || 0) + draftOutstanding
    : null;

  if (hasRentalMetricsColumns) {
    updatePayload.borrowed_total_quantity = nextBorrowedTotal;
  }

  await fetchInventory();
  const adjustments = getInventoryAdjustments(order);
  const appliedAdjustments = [];
  let itemsDeleted = false;

  try {
    for (const adjustment of adjustments) {
      await applyInventoryAdjustment(adjustment);
      appliedAdjustments.push(adjustment);
    }

    const { error: deleteError } = await supabaseClient
      .from(RENTAL_ITEMS_TABLE)
      .delete()
      .eq("order_id", order.id);
    if (deleteError) {
      throw new Error(`Blad usuwania poprzednich pozycji WZ: ${deleteError.message}`);
    }
    itemsDeleted = true;

    const draftPayload = buildDraftInsertPayload(order.id);
    const { error: insertError } = await supabaseClient
      .from(RENTAL_ITEMS_TABLE)
      .insert(draftPayload);
    if (insertError) {
      throw new Error(`Blad zapisu nowych pozycji WZ: ${insertError.message}`);
    }

    const { error: updateError } = await supabaseClient
      .from(RENTAL_ORDERS_TABLE)
      .update(updatePayload)
      .eq("id", order.id);
    if (updateError) {
      throw new Error(`Blad aktualizacji danych WZ: ${updateError.message}`);
    }
  } catch (error) {
    if (itemsDeleted) {
      await supabaseClient.from(RENTAL_ITEMS_TABLE).delete().eq("order_id", order.id);
      const originalPayload = buildOriginalInsertPayload(order);
      if (originalPayload.length) {
        await supabaseClient.from(RENTAL_ITEMS_TABLE).insert(originalPayload);
      }
    }
    if (appliedAdjustments.length) {
      await rollbackInventoryAdjustments(appliedAdjustments);
    }
    throw error;
  }
}

async function receiveReturn() {
  const order = getSelectedOrder();
  if (!order) {
    throw new Error("Wybierz listę wynajmu.");
  }
  if (order.settledAt) {
    throw new Error("Ten dokument jest juz rozliczony.");
  }
  if (order.actualReturnDate) {
    throw new Error("Ten dokument ma juz przyjety zwrot.");
  }

  if (
    selectedDraftItems.length !== order.items.length ||
    selectedDraftItems.some(
      (item) => (getOriginalQuantityMap(order).get(item.deviceCode) || 0) !== item.quantity
    )
  ) {
    const proceed = confirm("Masz niezapisane zmiany w liscie WZ. Zwrot zostanie przyjety na podstawie zapisanej wersji dokumentu. Kontynuowac?");
    if (!proceed) {
      return;
    }
  }

  const returnPlan = order.items.map((item) => {
    const requestedQuantity = Number(returnDraftQuantities.get(item.id));
    const safeRequested = Number.isInteger(requestedQuantity)
      ? requestedQuantity
      : item.quantity;

    if (safeRequested < 0 || safeRequested > item.quantity) {
      throw new Error(`Niepoprawna ilosc zwrotu dla ${item.name}.`);
    }

    return {
      ...item,
      returnQuantity: safeRequested,
      remainingQuantity: item.quantity - safeRequested,
    };
  });

  const returnedNow = returnPlan.reduce((sum, item) => sum + item.returnQuantity, 0);
  if (returnedNow < 1) {
    throw new Error("Podaj co najmniej jedna sztuke do zwrotu.");
  }

  const remainingAfter = returnPlan.reduce((sum, item) => sum + item.remainingQuantity, 0);

  await fetchInventory();

  const adjustments = [];
  for (const item of returnPlan) {
    if (item.returnQuantity < 1) continue;
    const inventoryItem = getInventoryItem(item.deviceCode);
    if (!inventoryItem) {
      throw new Error(`Brak pozycji magazynowej dla ${item.deviceCode}.`);
    }
    adjustments.push({
      deviceCode: item.deviceCode,
      previousCurrentQuantity: inventoryItem.currentQuantity,
      nextCurrentQuantity: Math.min(
        inventoryItem.totalQuantity,
        inventoryItem.currentQuantity + item.returnQuantity
      ),
    });
  }

  const appliedAdjustments = [];

  try {
    for (const adjustment of adjustments) {
      await applyInventoryAdjustment(adjustment);
      appliedAdjustments.push(adjustment);
    }

    if (hasRentalItemReturnColumns) {
      for (const item of returnPlan) {
        const itemPayload = {
          quantity: item.remainingQuantity,
          returned_quantity: Number(item.returnedQuantity || 0) + item.returnQuantity,
          borrowed_quantity: Number(item.borrowedQuantity || item.quantity || 0),
        };
        const { error: updateItemError } = await supabaseClient
          .from(RENTAL_ITEMS_TABLE)
          .update(itemPayload)
          .eq("id", item.id);
        if (updateItemError) {
          throw new Error(`Blad aktualizacji pozycji zwrotu: ${updateItemError.message}`);
        }
      }
    } else {
      const { error: deleteError } = await supabaseClient
        .from(RENTAL_ITEMS_TABLE)
        .delete()
        .eq("order_id", order.id);
      if (deleteError) {
        throw new Error(`Blad aktualizacji pozycji zwrotu: ${deleteError.message}`);
      }

      const remainingItemsPayload = returnPlan
        .filter((item) => item.remainingQuantity > 0)
        .map((item) => ({
          order_id: order.id,
          device_code: item.deviceCode,
          department: item.department,
          category: item.category,
          producer: item.producer,
          name: item.name,
          quantity: item.remainingQuantity,
        }));

      if (remainingItemsPayload.length) {
        const { error: insertError } = await supabaseClient
          .from(RENTAL_ITEMS_TABLE)
          .insert(remainingItemsPayload);
        if (insertError) {
          throw new Error(`Blad zapisu pozostalych pozycji WZ: ${insertError.message}`);
        }
      }
    }

    const nextReturnedQuantity = hasRentalMetricsColumns
      ? Math.min(
          Number(order.borrowedTotalQuantity || 0),
          Number(order.returnedQuantity || 0) + returnedNow
        )
      : null;

    const orderPayload = {};
    if (hasRentalMetricsColumns) {
      orderPayload.returned_quantity = nextReturnedQuantity;
    }
    if (hasSettlementColumn) {
      orderPayload.settled_at = null;
    }
    orderPayload.actual_return_date = remainingAfter === 0
      ? new Date().toISOString().slice(0, 10)
      : null;

    const { error: orderError } = await supabaseClient
      .from(RENTAL_ORDERS_TABLE)
      .update(orderPayload)
      .eq("id", order.id);
    if (orderError) {
      throw new Error(`Blad oznaczania zwrotu: ${orderError.message}`);
    }

    return remainingAfter === 0 ? "full" : "partial";
  } catch (error) {
    if (hasRentalItemReturnColumns) {
      for (const originalItem of order.items) {
        const rollbackPayload = {
          quantity: originalItem.quantity,
          returned_quantity: Number(originalItem.returnedQuantity || 0),
          borrowed_quantity: Number(originalItem.borrowedQuantity || originalItem.quantity || 0),
        };
        await supabaseClient
          .from(RENTAL_ITEMS_TABLE)
          .update(rollbackPayload)
          .eq("id", originalItem.id);
      }
    } else {
      await supabaseClient.from(RENTAL_ITEMS_TABLE).delete().eq("order_id", order.id);
      const originalPayload = buildOriginalInsertPayload(order);
      if (originalPayload.length) {
        await supabaseClient.from(RENTAL_ITEMS_TABLE).insert(originalPayload);
      }
    }
    if (appliedAdjustments.length) {
      await rollbackInventoryAdjustments(appliedAdjustments);
    }
    throw error;
  }
}

async function settleReturnedOrder() {
  const order = getSelectedOrder();
  if (!order) {
    throw new Error("Wybierz listę wynajmu.");
  }
  if (!order.actualReturnDate) {
    throw new Error("Najpierw przyjmij zwrot, potem rozlicz dokument.");
  }
  if (order.settledAt) {
    throw new Error("Ten dokument jest juz rozliczony.");
  }
  if (!hasSettlementColumn) {
    throw new Error("Brak kolumny settled_at w bazie. Poczekaj na migracje Supabase.");
  }

  const { error } = await supabaseClient
    .from(RENTAL_ORDERS_TABLE)
    .update({ settled_at: new Date().toISOString() })
    .eq("id", order.id);

  if (error) {
    throw new Error(`Blad rozliczania dokumentu: ${error.message}`);
  }
}

function getDeleteRestoreAdjustments(order) {
  if (!order || order.actualReturnDate) {
    return [];
  }

  return order.items.map((item) => {
    const inventoryItem = getInventoryItem(item.deviceCode);
    if (!inventoryItem) {
      throw new Error(`Brak pozycji magazynowej dla ${item.deviceCode}.`);
    }

    return {
      deviceCode: item.deviceCode,
      previousCurrentQuantity: inventoryItem.currentQuantity,
      nextCurrentQuantity: Math.min(
        inventoryItem.totalQuantity,
        inventoryItem.currentQuantity + item.quantity
      ),
    };
  });
}

async function deleteSelectedOrder() {
  const order = getSelectedOrder();
  if (!order) {
    throw new Error("Wybierz listę wynajmu.");
  }

  const hasUnsavedChanges =
    selectedDraftItems.length !== order.items.length ||
    selectedDraftItems.some(
      (item) => (getOriginalQuantityMap(order).get(item.deviceCode) || 0) !== item.quantity
    ) ||
    orderFields.contractorName.value.trim() !== order.contractorName ||
    orderFields.contractorContact.value.trim() !== order.contractorContact ||
    orderFields.contractorPhone.value.trim() !== order.contractorPhone ||
    orderFields.contractorEmail.value.trim() !== order.contractorEmail ||
    (orderFields.declaredReturnDate.value || "") !== (order.declaredReturnDate || "") ||
    orderFields.notes.value.trim() !== order.notes;

  const confirmationMessage = hasUnsavedChanges
    ? "Masz niezapisane zmiany. Czy na pewno usunac WZ? Zostanie usunieta zapisana wersja dokumentu."
    : "Czy na pewno usunac WZ?";

  if (!confirm(confirmationMessage)) {
    return false;
  }

  await fetchInventory();
  const restoreAdjustments = getDeleteRestoreAdjustments(order);
  const appliedAdjustments = [];

  try {
    for (const adjustment of restoreAdjustments) {
      await applyInventoryAdjustment(adjustment);
      appliedAdjustments.push(adjustment);
    }

    const { error } = await supabaseClient
      .from(RENTAL_ORDERS_TABLE)
      .delete()
      .eq("id", order.id);

    if (error) {
      throw new Error(`Blad usuwania WZ: ${error.message}`);
    }
  } catch (error) {
    if (appliedAdjustments.length) {
      await rollbackInventoryAdjustments(appliedAdjustments);
    }
    throw error;
  }

  return true;
}

async function refreshData() {
  await fetchInventory();
  await fetchRentalOrders();

  if (!selectedOrderId) {
    throw new Error("Brak identyfikatora dokumentu WZ w adresie.");
  }

  if (!rentalOrders.some((order) => order.id === selectedOrderId)) {
    throw new Error("Nie znaleziono wybranego dokumentu WZ.");
  }

  selectOrder(selectedOrderId);
}

inventoryAddSearch.addEventListener("input", renderInventoryAddList);

saveOrderChangesButton.addEventListener("click", async () => {
  setOrderResult();
  try {
    await saveSelectedOrderChanges();
    await refreshData();
    setOrderResult("Zapisano zmiany w wybranym WZ.", "success");
  } catch (error) {
    setOrderResult(error.message, "error");
  }
});

deleteOrderButton.addEventListener("click", async () => {
  setOrderResult();
  try {
    const deleted = await deleteSelectedOrder();
    if (!deleted) {
      return;
    }
    window.location.href = "rental-manage.html";
  } catch (error) {
    setOrderResult(error.message, "error");
  }
});

receiveReturnButton.addEventListener("click", async () => {
  setOrderResult();
  try {
    const order = getSelectedOrder();
    if (!order) {
      throw new Error("Wybierz listę wynajmu.");
    }

    if (order.actualReturnDate) {
      await settleReturnedOrder();
      await refreshData();
      setOrderResult("Dokument zostal rozliczony.", "success");
      return;
    }

    const returnType = await receiveReturn();
    await refreshData();
    setOrderResult(
      returnType === "full"
        ? "Przyjeto pelny zwrot i zaktualizowano stan magazynu."
        : "Przyjeto czesciowy zwrot i zaktualizowano stan magazynu.",
      "success"
    );
  } catch (error) {
    setOrderResult(error.message, "error");
  }
});

async function init() {
  loadBuildVersion();
  try {
    const params = new URLSearchParams(window.location.search);
    selectedOrderId = params.get("id");

    ensureSupabaseConfigured();
    await detectSettlementColumn();
    await detectRentalMetricsColumns();
    await detectRentalItemReturnColumns();
    await detectWarehouseStockColumns();
    renderDataMode(
      hasSplitStockColumns
        ? "Dane: Supabase (cloud)"
        : "Dane: Supabase (cloud, bez kolumn total/current)"
    );
    await refreshData();
  } catch (error) {
    renderDataMode("Dane: blad konfiguracji Supabase");
    toggleOrderActions(null);
    renderSelectedOrderHeader(null);
    setOrderResult(error.message, "error");
  }
}

init();