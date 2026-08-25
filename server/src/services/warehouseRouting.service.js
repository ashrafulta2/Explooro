/**
 * warehouseRouting.service.js — Multi-Location Warehouse GIS Proximity Routing Engine (Prompt 11.1).
 *
 * Implements `idea proposition.md` §AK & Prompt 11.1 REQUIREMENTS 2:
 * - Computes Great-Circle Distance (Haversine Formula) against active `warehouse_nodes` coordinates.
 * - Resolves customer destination district against standard Bangladesh 64-district coordinates.
 * - Filters warehouses holding required stock (`stockList`).
 * - Honours admin/supplier-configured warehouse `priority` and split-order rules.
 */

// Coordinates (latitude, longitude) of all 64 districts in Bangladesh for proximity calculation
export const BD_DISTRICT_COORDINATES = {
  // Dhaka Division
  dhaka: { lat: 23.8103, lng: 90.4125 },
  gazipur: { lat: 24.0023, lng: 90.4267 },
  narayanganj: { lat: 23.6238, lng: 90.5000 },
  tangail: { lat: 24.2513, lng: 89.9167 },
  narsingdi: { lat: 23.9322, lng: 90.7154 },
  faridpur: { lat: 23.6071, lng: 89.8429 },
  manikganj: { lat: 23.8617, lng: 90.0003 },
  munshiganj: { lat: 23.5422, lng: 90.5305 },
  gopalganj: { lat: 23.0051, lng: 89.8266 },
  madaripur: { lat: 23.1641, lng: 90.1897 },
  rajbari: { lat: 23.7574, lng: 89.6445 },
  shariatpur: { lat: 23.2423, lng: 90.4348 },
  kishoreganj: { lat: 24.4449, lng: 90.7766 },

  // Chittagong Division
  chittagong: { lat: 22.3569, lng: 91.7832 },
  chattogram: { lat: 22.3569, lng: 91.7832 },
  coxsbazar: { lat: 21.4272, lng: 92.0058 },
  "cox's bazar": { lat: 21.4272, lng: 92.0058 },
  cumilla: { lat: 23.4682, lng: 91.1788 },
  comilla: { lat: 23.4682, lng: 91.1788 },
  feni: { lat: 23.0186, lng: 91.3966 },
  brahmanbaria: { lat: 23.9571, lng: 91.1119 },
  noakhali: { lat: 22.8696, lng: 91.0994 },
  lakshmipur: { lat: 22.9425, lng: 90.8412 },
  chandpur: { lat: 23.2333, lng: 90.6667 },
  khagrachhari: { lat: 23.1193, lng: 91.9847 },
  rangamati: { lat: 22.6574, lng: 92.1753 },
  bandarban: { lat: 22.1953, lng: 92.2184 },

  // Rajshahi Division
  rajshahi: { lat: 24.3745, lng: 88.6042 },
  bogura: { lat: 24.8465, lng: 89.3777 },
  bogra: { lat: 24.8465, lng: 89.3777 },
  pabna: { lat: 24.0064, lng: 89.2372 },
  sirajganj: { lat: 24.4534, lng: 89.7008 },
  naogaon: { lat: 24.7936, lng: 88.9318 },
  natore: { lat: 24.4206, lng: 88.9324 },
  chapainawabganj: { lat: 24.5965, lng: 88.2775 },
  joypurhat: { lat: 25.1015, lng: 89.0277 },

  // Sylhet Division
  sylhet: { lat: 24.8949, lng: 91.8687 },
  moulvibazar: { lat: 24.4829, lng: 91.7774 },
  habiganj: { lat: 24.3749, lng: 91.4155 },
  sunamganj: { lat: 25.0658, lng: 91.3950 },

  // Khulna Division
  khulna: { lat: 22.8456, lng: 89.5403 },
  jashore: { lat: 23.1664, lng: 89.2182 },
  jessore: { lat: 23.1664, lng: 89.2182 },
  kushtia: { lat: 23.9013, lng: 89.1205 },
  satkhira: { lat: 22.7185, lng: 89.0705 },
  bagerhat: { lat: 22.6516, lng: 89.7859 },
  chuadanga: { lat: 23.6402, lng: 88.8418 },
  jhenaidah: { lat: 23.5450, lng: 89.1726 },
  magura: { lat: 23.4873, lng: 89.4199 },
  meherpur: { lat: 23.7622, lng: 88.6318 },
  narail: { lat: 23.1725, lng: 89.5127 },

  // Barishal Division
  barishal: { lat: 22.7010, lng: 90.3535 },
  barisal: { lat: 22.7010, lng: 90.3535 },
  bhola: { lat: 22.6859, lng: 90.6481 },
  patuakhali: { lat: 22.3596, lng: 90.3299 },
  pirojpur: { lat: 22.5841, lng: 89.9720 },
  barguna: { lat: 22.0953, lng: 90.1121 },
  jhalokati: { lat: 22.6406, lng: 90.1987 },

  // Rangpur Division
  rangpur: { lat: 25.7439, lng: 89.2752 },
  dinajpur: { lat: 25.6217, lng: 88.6355 },
  kurigram: { lat: 25.8054, lng: 89.6362 },
  gaibandha: { lat: 25.3288, lng: 89.5281 },
  nilphamari: { lat: 25.9318, lng: 88.8560 },
  panchagarh: { lat: 26.3411, lng: 88.5542 },
  thakurgaon: { lat: 26.0337, lng: 88.4617 },
  lalmonirhat: { lat: 25.9923, lng: 89.2847 },

  // Mymensingh Division
  mymensingh: { lat: 24.7471, lng: 90.4203 },
  jamalpur: { lat: 24.9375, lng: 89.9378 },
  netrokona: { lat: 24.8709, lng: 90.7279 },
  sherpur: { lat: 25.0205, lng: 90.0153 },
};

/**
 * Calculates the Great-Circle Distance between two coordinate points on Earth using the Haversine formula.
 *
 * @param {number} lat1 - Latitude of point 1 in degrees
 * @param {number} lon1 - Longitude of point 1 in degrees
 * @param {number} lat2 - Latitude of point 2 in degrees
 * @param {number} lon2 - Longitude of point 2 in degrees
 * @returns {number} Distance in kilometers
 */
export function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's mean radius in km
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

/**
 * Normalizes a district name to match the coordinates dictionary.
 */
export function normalizeDistrictName(district) {
  if (!district) return 'dhaka';
  return district.toString().toLowerCase().trim().replace(/[-_]/g, ' ');
}

/**
 * Resolves coordinates for a given district name.
 */
export function getDistrictCoordinates(district) {
  const normalized = normalizeDistrictName(district);
  return BD_DISTRICT_COORDINATES[normalized] || BD_DISTRICT_COORDINATES['dhaka'];
}

/**
 * Finds the nearest warehouse node holding required stock relative to the destination district.
 *
 * Rules:
 * 1. Proximity: Calculates great-circle distance from destination district to each active warehouse node.
 * 2. Stock eligibility: Filters nodes holding stock for the given `stockList` (e.g. `[{ productId, variantId, qty }]`).
 * 3. Priority tie-breaker / scoring: If two warehouses are equidistant (or within 15 km), the higher `priority` node wins.
 * 4. Split-order evaluation: Checks if all items can be fulfilled from a single nearest node, or if split consignments are required.
 *
 * @param {string} district - Destination district (e.g. 'Sylhet', 'Chittagong', 'Dhaka')
 * @param {Array<Object>} stockList - Array of items to fulfill `{ productId, variantId, qty }`
 * @param {Array<Object>|Object} dbOrNodes - Database pool OR explicit array of warehouse nodes with inventory
 * @returns {Promise<Object>} Routing resolution result
 */
export async function findNearestWarehouse(district, stockList = [], dbOrNodes = null) {
  const destCoords = getDistrictCoordinates(district);

  let warehouseNodes = [];

  // If db pool passed, query warehouse nodes with stock
  if (dbOrNodes && typeof dbOrNodes.query === 'function') {
    const { rows } = await dbOrNodes.query(`
      SELECT
        wn.id,
        wn.ref,
        wn.supplier_id,
        wn.name,
        wn.division,
        wn.district,
        wn.upazila,
        wn.address_line,
        wn.latitude,
        wn.longitude,
        wn.priority,
        wn.is_active,
        COALESCE(
          json_agg(
            json_build_object(
              'product_id', ws.product_id,
              'variant_id', ws.variant_id,
              'stock_qty', ws.stock_qty,
              'reserved_qty', ws.reserved_qty
            )
          ) FILTER (WHERE ws.product_id IS NOT NULL),
          '[]'::json
        ) AS inventory
      FROM warehouse_nodes wn
      LEFT JOIN warehouse_stock ws ON ws.warehouse_node_id = wn.id
      WHERE wn.is_active = true
      GROUP BY wn.id
    `);
    warehouseNodes = rows;
  } else if (Array.isArray(dbOrNodes)) {
    warehouseNodes = dbOrNodes;
  }

  if (warehouseNodes.length === 0) {
    return {
      selectedWarehouse: null,
      distanceKm: null,
      isSplitRequired: false,
      splits: [],
      allEligibleWarehouses: [],
      reason: 'NO_ACTIVE_WAREHOUSE_NODES',
    };
  }

  // 1. Calculate distance for every node
  const scoredNodes = warehouseNodes.map((node) => {
    const lat = Number(node.latitude) || destCoords.lat;
    const lng = Number(node.longitude) || destCoords.lng;
    const distanceKm = calculateHaversineDistance(destCoords.lat, destCoords.lng, lat, lng);

    // Check inventory coverage
    const inventory = Array.isArray(node.inventory) ? node.inventory : [];
    let fulfillsAll = true;
    let fulfilledCount = 0;

    for (const item of stockList) {
      const match = inventory.find(
        (inv) =>
          Number(inv.product_id) === Number(item.productId) &&
          (item.variantId ? Number(inv.variant_id) === Number(item.variantId) : true)
      );

      const available = match ? (Number(match.stock_qty) - Number(match.reserved_qty || 0)) : 0;
      if (available >= (item.qty || 1)) {
        fulfilledCount += 1;
      } else {
        fulfillsAll = false;
      }
    }

    // Proximity score with priority weighting: distance (lower is better), priority (higher is better)
    return {
      ...node,
      latitude: lat,
      longitude: lng,
      distanceKm,
      fulfillsAll,
      fulfilledCount,
    };
  });

  // 2. Filter nodes that satisfy all items, or rank by coverage & proximity
  const completeFulfillmentNodes = scoredNodes.filter((n) => n.fulfillsAll);

  // Sorting comparator: Proximity first, priority tie-breaker (higher priority wins)
  const sortComparator = (a, b) => {
    // If distance difference is within 15 km, priority decides
    const distDiff = a.distanceKm - b.distanceKm;
    if (Math.abs(distDiff) <= 15) {
      return (Number(b.priority) || 0) - (Number(a.priority) || 0);
    }
    return distDiff;
  };

  if (completeFulfillmentNodes.length > 0) {
    completeFulfillmentNodes.sort(sortComparator);
    const best = completeFulfillmentNodes[0];

    return {
      selectedWarehouse: best,
      distanceKm: best.distanceKm,
      isSplitRequired: false,
      splits: [{ warehouseNodeId: best.id, warehouseName: best.name, items: stockList, distanceKm: best.distanceKm }],
      allEligibleWarehouses: completeFulfillmentNodes,
    };
  }

  // 3. If no single warehouse holds everything, evaluate split-order routing
  scoredNodes.sort(sortComparator);
  const bestCandidate = scoredNodes[0] || null;

  return {
    selectedWarehouse: bestCandidate,
    distanceKm: bestCandidate?.distanceKm || null,
    isSplitRequired: stockList.length > 1,
    splits: scoredNodes.slice(0, 2).map((n) => ({
      warehouseNodeId: n.id,
      warehouseName: n.name,
      distanceKm: n.distanceKm,
    })),
    allEligibleWarehouses: scoredNodes,
  };
}
