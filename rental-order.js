const TABLE_NAME = "warehouse_items";
const RENTAL_ORDERS_TABLE = "rental_orders";
const RENTAL_ITEMS_TABLE = "rental_order_items";

const buildVersion = document.getElementById("build-version");
const dataMode = document.getElementById("data-mode");
const selectedOrderMeta = document.getElementById("selected-order-meta");
const selectedOrderStatus = document.getElementById("selected-order-status");
const selectedOrderSummary = document.getElementById("selected-order-summary");
const orderResult = document.getElementById("order-result");
const saveOrderChangesButton = document.getElementById("save-order-changes");
const receiveReturnButton = document.getElementById("receive-return");
const selectedItemsBody = document.getElementById("selected-items-body");
const selectedItemsEmpty = document.getElementById("selected-items-empty");
const selectedItemRowTemplate = document.getElementById("selected-item-row-template");
const inventoryAddSearch = document.getElementById("inventory-add-search");
const inventoryAddBody = document.getElementById("inventory-add-body");
const inventoryAddRowTemplate = document.getElementById("inventory-add-row-template");

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
let inventoryItems = [];
let rentalOrders = [];
let selectedOrderId = null;
let selectedDraftItems = [];

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
  return {
    id: row.id,
    contractorName: row.contractor_name || "",
    contractorContact: row.contractor_contact || "",
    contractorPhone: row.contractor_phone || "",
    contractorEmail: row.contractor_email || "",
    declaredReturnDate: row.declared_return_date || "",
    actualReturnDate: row.actual_return_date || "",
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
  const { data, error } = await supabaseClient
    .from(RENTAL_ORDERS_TABLE)
    .select("id, contractor_name, contractor_contact, contractor_phone, contractor_email, declared_return_date, actual_return_date, notes, created_at, rental_order_items(id, device_code, department, category, producer, name, quantity)")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Błąd pobierania list wynajmu: ${error.message}`);
  rentalOrders = (data || []).map(fromOrderRow);
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
  if (order.actualReturnDate) {
    return {
      label: `Zwrocono ${formatDate(order.actualReturnDate)}`,
      tone: "returned",
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
  const days = status.days === null ? "-" : status.days;

  selectedOrderMeta.textContent = `Dokument z ${formatDateTime(order.createdAt)} • ID: ${order.id}`;
  selectedOrderStatus.textContent = status.label;
  selectedOrderStatus.className = `status-badge status-${status.tone}`;
  selectedOrderSummary.innerHTML = [
    ["Pozycji na WZ", totalItems],
    ["Dni do zwrotu", days],
    ["Faktyczny zwrot", order.actualReturnDate ? formatDate(order.actualReturnDate) : "brak"],
  ]
    .map(([label, value]) => `<div class="detail-chip"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function toggleOrderActions(order) {
  const isSelected = Boolean(order);
  const isReturned = Boolean(order?.actualReturnDate);
  saveOrderChangesButton.disabled = !isSelected || isReturned;
  receiveReturnButton.disabled = !isSelected || isReturned;

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
      renderSelectedOrderHeader(getSelectedOrder());
      renderInventoryAddList();
    });

    const removeButton = row.querySelector('[data-action="remove-item"]');
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
  } else {
    selectedDraftItems.push({
      deviceCode: item.deviceCode,
      department: item.department,
      category: item.category,
      producer: item.producer,
      name: item.name,
      quantity: 1,
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
    throw new Error("Uzupelnij nazwe kontrahenta.");
  }
  if (!payload.declared_return_date) {
    throw new Error("Uzupelnij deklarowana date zwrotu.");
  }
  if (!selectedDraftItems.length) {
    throw new Error("Lista WZ musi zawierac co najmniej jedna pozycje.");
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
  }));
}

async function saveSelectedOrderChanges() {
  const order = getSelectedOrder();
  const updatePayload = validateSelectedOrder(order);

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

  await fetchInventory();
  for (const item of order.items) {
    const inventoryItem = getInventoryItem(item.deviceCode);
    if (!inventoryItem) {
      throw new Error(`Brak pozycji magazynowej dla ${item.deviceCode}.`);
    }
    const nextCurrentQuantity = Math.min(
      inventoryItem.totalQuantity,
      inventoryItem.currentQuantity + item.quantity
    );
    const payload = hasSplitStockColumns
      ? { current_quantity: nextCurrentQuantity, quantity: nextCurrentQuantity }
      : { quantity: nextCurrentQuantity };

    const { error } = await supabaseClient
      .from(TABLE_NAME)
      .update(payload)
      .eq("device_code", item.deviceCode);
    if (error) {
      throw new Error(`Blad przyjmowania zwrotu dla ${item.deviceCode}: ${error.message}`);
    }
  }

  const today = new Date();
  const isoDate = today.toISOString().slice(0, 10);
  const { error: orderError } = await supabaseClient
    .from(RENTAL_ORDERS_TABLE)
    .update({ actual_return_date: isoDate })
    .eq("id", order.id);

  if (orderError) {
    throw new Error(`Blad oznaczania zwrotu: ${orderError.message}`);
  }
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

receiveReturnButton.addEventListener("click", async () => {
  setOrderResult();
  try {
    await receiveReturn();
    await refreshData();
    setOrderResult("Przyjeto zwrot i zaktualizowano stan magazynu.", "success");
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