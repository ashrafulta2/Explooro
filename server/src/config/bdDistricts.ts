/**
 * bdDistricts.ts — the 64 district ids the checkout address form sends, grouped by division.
 *
 * WHY the server keeps its own copy: delivery zones (services/deliveryCharge.service.ts) are lists
 * of these ids, and a zone that names a district the form never sends would silently never match.
 * The ids must equal client/src/data/bangladeshGeo.ts `BANGLADESH_DIVISIONS`;
 * server/test/deliveryZones.test.js fails if the two drift.
 */

export const BD_DISTRICTS_BY_DIVISION: Readonly<Record<string, readonly string[]>> = Object.freeze({
  dhaka: ['dhaka_city', 'gazipur', 'narayanganj', 'tangail', 'faridpur', 'manikganj', 'munshiganj', 'narsingdi', 'kishoreganj', 'gopalganj', 'madaripur', 'rajbari', 'shariatpur'],
  chittagong: ['chittagong_city', 'coxs_bazar', 'cumilla', 'brahmanbaria', 'chandpur', 'feni', 'noakhali', 'lakshmipur', 'khagrachhari', 'rangamati', 'bandarban'],
  rajshahi: ['rajshahi_city', 'bogura', 'pabna', 'sirajganj', 'naogaon', 'natore', 'chapainawabganj', 'joypurhat'],
  khulna: ['khulna_city', 'jashore', 'kushtia', 'satkhira', 'bagerhat', 'jhenaidah', 'chuadanga', 'magura', 'meherpur', 'narail'],
  barisal: ['barisal_city', 'bhola', 'patuakhali', 'pirojpur', 'barguna', 'jhalokathi'],
  sylhet: ['sylhet_city', 'moulvibazar', 'habiganj', 'sunamganj'],
  rangpur: ['rangpur_city', 'dinajpur', 'gaibandha', 'kurigram', 'nilphamari', 'panchagarh', 'thakurgaon', 'lalmonirhat'],
  mymensingh: ['mymensingh_city', 'jamalpur', 'netrokona', 'sherpur'],
});

export const BD_DISTRICT_IDS: ReadonlySet<string> = new Set(Object.values(BD_DISTRICTS_BY_DIVISION).flat());
