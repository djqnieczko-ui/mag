const TABLE_NAME = "warehouse_items";
const RENTAL_ORDERS_TABLE = "rental_orders";
const RENTAL_ITEMS_TABLE = "rental_order_items";

const buildVersion = document.getElementById("build-version");
const dataMode = document.getElementById("data-mode");
const inventoryItemsBody = document.getElementById("inventory-items-body");
const inventoryRowTemplate = document.getElementById("inventory-row-template");
const wzItemsBody = document.getElementById("wz-items-body");
const wzRowTemplate = document.getElementById("wz-row-template");
const rentalResult = document.getElementById("rental-result");
const wzEmpty = document.getElementById("wz-empty");
const inventorySearch = document.getElementById("inventory-search");
const filterDepartment = document.getElementById("filter-department");
const filterCategory = document.getElementById("filter-category");
const filterProducer = document.getElementById("filter-producer");
const saveRentalButton = document.getElementById("save-rental");

const contractorFields = {
  name: document.getElementById("contractor-name"),
  contact: document.getElementById("contractor-contact"),
  phone: document.getElementById("contractor-phone"),
  email: document.getElementById("contractor-email"),
  declaredReturnDate: document.getElementById("declared-return-date"),
  notes: document.getElementById("contractor-notes"),
};

const supabaseUrl = window.APP_CONFIG?.supabaseUrl || "";
const supabaseAnonKey = window.APP_CONFIG?.supabaseAnonKey || "";
const supabaseClient = window.supabase?.createClient(supabaseUrl, supabaseAnonKey);

let inventoryItems = [];
let rentalDraft = [];
let hasSplitStockColumns = true;

function normalizeText(value) {
  return String(value).trim().toLowerCase();
}

function ensureSupabaseConfigured() {
  if (!supabaseUrl || !supabaseAnonKey || !supabaseClient) {
    throw new Error("Brak konfiguracji Supabase w config.js");
  }
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

function fromDbRow(row) {
  return {
    department: row.department,
    category: row.category,
    producer: row.producer,
    name: row.name,
    totalQuantity: Number(row.total_quantity ?? row.quantity ?? 0),
    currentQuantity: Number(row.current_quantity ?? row.quantity ?? 0),
    weight: Number(row.weight),
    deviceCode: row.device_code,
  };
}

async function fetchInventory() {
  const selectFields = hasSplitStockColumns
    ? "device_code, department, category, producer, name, weight, quantity, total_quantity, current_quantity"
    : "device_code, department, category, producer, name, weight, quantity";

  const { data, error } = await supabaseClient
    .from(TABLE_NAME)
    .select(selectFields)
    .order("name", { ascending: true });

  if (error) throw new Error(`Błąd pobierania magazynu: ${error.message}`);
  inventoryItems = (data || []).map(fromDbRow);
}

function renderSelectOptions(select, values, placeholder, selectedValue = "") {
  select.innerHTML = "";
  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent = placeholder;
  select.appendChild(placeholderOption);

  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    if (value === selectedValue) option.selected = true;
    select.appendChild(option);
  }
}

function renderFilterOptions() {
  const selectedDepartment = filterDepartment.value;
  const selectedCategory = filterCategory.value;
  const selectedProducer = filterProducer.value;

  const departments = [...new Set(inventoryItems.map((item) => item.department))].sort((a, b) => a.localeCompare(b, "pl"));
  const categorySource = selectedDepartment ? inventoryItems.filter((item) => item.department === selectedDepartment) : inventoryItems;
  const categories = [...new Set(categorySource.map((item) => item.category))].sort((a, b) => a.localeCompare(b, "pl"));
  const producerSource = selectedDepartment ? inventoryItems.filter((item) => item.department === selectedDepartment) : inventoryItems;
  const producers = [...new Set(producerSource.map((item) => item.producer))].sort((a, b) => a.localeCompare(b, "pl"));

  renderSelectOptions(filterDepartment, departments, "Wszystkie dzialy", selectedDepartment);
  renderSelectOptions(filterCategory, categories, "Wszystkie kategorie", selectedCategory);
  renderSelectOptions(filterProducer, producers, "Wszyscy producenci", selectedProducer);

  if (selectedCategory && !categories.includes(selectedCategory)) filterCategory.value = "";
  if (selectedProducer && !producers.includes(selectedProducer)) filterProducer.value = "";
}

function getFilteredInventory() {
  const query = normalizeText(inventorySearch.value);
  const selectedDepartment = filterDepartment.value;
  const selectedCategory = filterCategory.value;
  const selectedProducer = filterProducer.value;

  return inventoryItems
    .filter((item) => {
      const haystack = [item.department, item.category, item.producer, item.name, item.deviceCode]
        .map(normalizeText)
        .join(" ");
      return haystack.includes(query)
        && (!selectedDepartment || item.department === selectedDepartment)
        && (!selectedCategory || item.category === selectedCategory)
        && (!selectedProducer || item.producer === selectedProducer);
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pl"));
}

function getDraftEntry(deviceCode) {
  return rentalDraft.find((item) => item.deviceCode === deviceCode);
}

function addToDraft(item) {
  const existing = getDraftEntry(item.deviceCode);
  if (existing) {
    if (existing.rentQuantity >= existing.availableQuantity) {
      rentalResult.textContent = `Brak większej dostępnej ilości dla ${item.name}.`;
      rentalResult.className = "csv-result error";
      return;
    }
    existing.rentQuantity += 1;
  } else {
    rentalDraft.push({
      ...item,
      availableQuantity: item.currentQuantity,
      rentQuantity: 1,
    });
  }

  rentalResult.textContent = "";
  rentalResult.className = "csv-result";
  renderDraft();
}

function removeFromDraft(deviceCode) {
  rentalDraft = rentalDraft.filter((item) => item.deviceCode !== deviceCode);
  renderDraft();
}

function renderDraft() {
  wzItemsBody.innerHTML = "";
  wzEmpty.style.display = rentalDraft.length ? "none" : "block";

  for (const item of rentalDraft) {
    const row = wzRowTemplate.content.cloneNode(true);
    row.querySelector('[data-field="department"]').textContent = item.department;
    row.querySelector('[data-field="category"]').textContent = item.category;
    row.querySelector('[data-field="producer"]').textContent = item.producer;
    row.querySelector('[data-field="name"]').textContent = item.name;
    row.querySelector('[data-field="available"]').textContent = item.availableQuantity;
    row.querySelector('[data-field="deviceCode"]').textContent = item.deviceCode;

    const quantityInput = row.querySelector('[data-field="rentQuantity"]');
    quantityInput.value = item.rentQuantity;
    quantityInput.max = item.availableQuantity;
    quantityInput.addEventListener("input", () => {
      const nextValue = Number(quantityInput.value);
      if (Number.isNaN(nextValue) || nextValue < 1) {
        quantityInput.value = item.rentQuantity;
        return;
      }
      item.rentQuantity = Math.min(nextValue, item.availableQuantity);
      quantityInput.value = item.rentQuantity;
    });

    row.querySelector('[data-action="remove-from-wz"]').addEventListener("click", () => {
      removeFromDraft(item.deviceCode);
    });

    wzItemsBody.appendChild(row);
  }
}

function renderInventory() {
  renderFilterOptions();
  const filtered = getFilteredInventory();
  inventoryItemsBody.innerHTML = "";

  for (const item of filtered) {
    const row = inventoryRowTemplate.content.cloneNode(true);
    row.querySelector('[data-field="department"]').textContent = item.department;
    row.querySelector('[data-field="category"]').textContent = item.category;
    row.querySelector('[data-field="producer"]').textContent = item.producer;
    row.querySelector('[data-field="name"]').textContent = item.name;
    row.querySelector('[data-field="totalQuantity"]').textContent = item.totalQuantity;
    row.querySelector('[data-field="currentQuantity"]').textContent = item.currentQuantity;
    row.querySelector('[data-field="deviceCode"]').textContent = item.deviceCode;

    const addButton = row.querySelector('[data-action="add-to-wz"]');
    addButton.disabled = item.currentQuantity <= 0;
    addButton.addEventListener("click", () => addToDraft(item));

    inventoryItemsBody.appendChild(row);
  }
}

function getContractorPayload() {
  return {
    contractor_name: contractorFields.name.value.trim(),
    contractor_contact: contractorFields.contact.value.trim(),
    contractor_phone: contractorFields.phone.value.trim(),
    contractor_email: contractorFields.email.value.trim(),
    declared_return_date: contractorFields.declaredReturnDate.value || null,
    notes: contractorFields.notes.value.trim(),
  };
}

function validateDraft() {
  const contractor = getContractorPayload();
  if (!contractor.contractor_name) {
    throw new Error("Uzupelnij nazwe kontrahenta.");
  }
  if (!contractor.declared_return_date) {
    throw new Error("Uzupelnij deklarowana date zwrotu.");
  }
  if (!rentalDraft.length) {
    throw new Error("Dodaj co najmniej jedna pozycje do WZ.");
  }
  for (const item of rentalDraft) {
    if (!Number.isInteger(item.rentQuantity) || item.rentQuantity < 1) {
      throw new Error(`Niepoprawna ilosc dla ${item.name}.`);
    }
    if (item.rentQuantity > item.availableQuantity) {
      throw new Error(`Za duza ilosc dla ${item.name}. Dostepne: ${item.availableQuantity}.`);
    }
  }
  return contractor;
}

async function saveRental() {
  const contractor = validateDraft();
  await fetchInventory();

  for (const item of rentalDraft) {
    const liveItem = inventoryItems.find((entry) => entry.deviceCode === item.deviceCode);
    if (!liveItem) {
      throw new Error(`Pozycja ${item.name} nie istnieje juz w magazynie.`);
    }
    if (item.rentQuantity > liveItem.currentQuantity) {
      throw new Error(`Za duza ilosc dla ${item.name}. Dostepne teraz: ${liveItem.currentQuantity}.`);
    }
    item.availableQuantity = liveItem.currentQuantity;
  }

  const { data: orderData, error: orderError } = await supabaseClient
    .from(RENTAL_ORDERS_TABLE)
    .insert(contractor)
    .select("id")
    .single();

  if (orderError) throw new Error(`Blad zapisu WZ: ${orderError.message}`);

  const orderId = orderData.id;
  const itemsPayload = rentalDraft.map((item) => ({
    order_id: orderId,
    device_code: item.deviceCode,
    department: item.department,
    category: item.category,
    producer: item.producer,
    name: item.name,
    quantity: item.rentQuantity,
  }));

  const { error: itemsError } = await supabaseClient.from(RENTAL_ITEMS_TABLE).insert(itemsPayload);
  if (itemsError) {
    await supabaseClient.from(RENTAL_ORDERS_TABLE).delete().eq("id", orderId);
    throw new Error(`Blad zapisu pozycji WZ: ${itemsError.message}`);
  }

  for (const item of rentalDraft) {
    const newQuantity = item.availableQuantity - item.rentQuantity;
    const updatePayload = hasSplitStockColumns
      ? { current_quantity: newQuantity, quantity: newQuantity }
      : { quantity: newQuantity };
    const { error: updateError } = await supabaseClient
      .from(TABLE_NAME)
      .update(updatePayload)
      .eq("device_code", item.deviceCode);
    if (updateError) throw new Error(`Blad aktualizacji magazynu: ${updateError.message}`);
  }
}

function resetRentalForm() {
  for (const field of Object.values(contractorFields)) {
    field.value = "";
  }
  rentalDraft = [];
  renderDraft();
}

inventorySearch.addEventListener("input", renderInventory);
filterDepartment.addEventListener("change", renderInventory);
filterCategory.addEventListener("change", renderInventory);
filterProducer.addEventListener("change", renderInventory);

saveRentalButton.addEventListener("click", async () => {
  rentalResult.textContent = "";
  rentalResult.className = "csv-result";

  try {
    await saveRental();
    rentalResult.textContent = "Wypozyczenie zapisane poprawnie.";
    rentalResult.classList.add("success");
    resetRentalForm();
    await fetchInventory();
    renderInventory();
  } catch (error) {
    rentalResult.textContent = error.message;
    rentalResult.classList.add("error");
  }
});

async function init() {
  loadBuildVersion();
  try {
    ensureSupabaseConfigured();
    await detectWarehouseStockColumns();
    renderDataMode(
      hasSplitStockColumns
        ? "Dane: Supabase (cloud)"
        : "Dane: Supabase (cloud, bez kolumn total/current)"
    );
    await fetchInventory();
    renderDraft();
    renderInventory();
  } catch (error) {
    renderDataMode("Dane: blad konfiguracji Supabase");
    alert(error.message);
  }
}

init();
