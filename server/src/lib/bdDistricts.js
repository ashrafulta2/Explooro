/**
 * bdDistricts.js — Bangladesh's 8 divisions and 64 districts, and a best-effort district finder.
 *
 * The team-purchase form asks only for a recipient name and one free-text address, but orders store
 * division and district as columns (courier routing reads the district). findDistrict() looks for a
 * district name, English or Bangla, inside the address so those columns are filled when the buyer
 * wrote one. The list mirrors client/src/data/bangladeshGeo.js, with " City" dropped so "Dhaka"
 * matches as well as "Dhaka City".
 */

export const BD_DIVISIONS = Object.freeze({
  'Dhaka': [
    ["Dhaka", "ঢাকা"],
    ["Gazipur", "গাজীপুর"],
    ["Narayanganj", "নারায়ণগঞ্জ"],
    ["Tangail", "টাঙ্গাইল"],
    ["Faridpur", "ফরিদপুর"],
    ["Manikganj", "মানিকগঞ্জ"],
    ["Munshiganj", "মুন্সীগঞ্জ"],
    ["Narsingdi", "নরসিংদী"],
    ["Kishoreganj", "কিশোরগঞ্জ"],
    ["Gopalganj", "গোপালগঞ্জ"],
    ["Madaripur", "মাদারীপুর"],
    ["Rajbari", "রাজবাড়ী"],
    ["Shariatpur", "শরীয়তপুর"],
  ],
  'Chattogram': [
    ["Chattogram", "চট্টগ্রাম"],
    ["Cox's Bazar", "কক্সবাজার"],
    ["Cumilla", "কুমিল্লা"],
    ["Brahmanbaria", "ব্রাহ্মণবাড়িয়া"],
    ["Chandpur", "চাঁদপুর"],
    ["Feni", "ফেনী"],
    ["Noakhali", "নোয়াখালী"],
    ["Lakshmipur", "লক্ষ্মীপুর"],
    ["Khagrachhari", "খাগড়াছড়ি"],
    ["Rangamati", "রাঙ্গামাটি"],
    ["Bandarban", "বান্দরবান"],
  ],
  'Rajshahi': [
    ["Rajshahi", "রাজশাহী"],
    ["Bogura", "বগুড়া"],
    ["Pabna", "পাবনা"],
    ["Sirajganj", "সিরাজগঞ্জ"],
    ["Naogaon", "নওগাঁ"],
    ["Natore", "নাটোর"],
    ["Chapainawabganj", "চাঁপাইনবাবগঞ্জ"],
    ["Joypurhat", "জয়পুরহাট"],
  ],
  'Khulna': [
    ["Khulna", "খুলনা"],
    ["Jashore", "যশোর"],
    ["Kushtia", "কুষ্টিয়া"],
    ["Satkhira", "সাতক্ষীরা"],
    ["Bagerhat", "বাগেরহাট"],
    ["Jhenaidah", "ঝিনাইদহ"],
    ["Chuadanga", "চুয়াডাঙ্গা"],
    ["Magura", "মাগুরা"],
    ["Meherpur", "মেহেরপুর"],
    ["Narail", "নড়াইল"],
  ],
  'Barishal': [
    ["Barishal", "বরিশাল"],
    ["Bhola", "ভোলা"],
    ["Patuakhali", "পটুয়াখালী"],
    ["Pirojpur", "পিরোজপুর"],
    ["Barguna", "বরগুনা"],
    ["Jhalokathi", "ঝালকাঠি"],
  ],
  'Sylhet': [
    ["Sylhet", "সিলেট"],
    ["Moulvibazar", "মৌলভীবাজার"],
    ["Habiganj", "হবিগঞ্জ"],
    ["Sunamganj", "সুনামগঞ্জ"],
  ],
  'Rangpur': [
    ["Rangpur", "রংপুর"],
    ["Dinajpur", "দিনাজপুর"],
    ["Gaibandha", "গাইবান্ধা"],
    ["Kurigram", "কুড়িগ্রাম"],
    ["Nilphamari", "নীলফামারী"],
    ["Panchagarh", "পঞ্চগড়"],
    ["Thakurgaon", "ঠাকুরগাঁও"],
    ["Lalmonirhat", "লালমনিরহাট"],
  ],
  'Mymensingh': [
    ["Mymensingh", "ময়মনসিংহ"],
    ["Jamalpur", "জামালপুর"],
    ["Netrokona", "নেত্রকোণা"],
    ["Sherpur", "শেরপুর"],
  ],
});

const ENTRIES = Object.entries(BD_DIVISIONS).flatMap(([division, districts]) =>
  districts.map(([en, bn]) => ({
    division,
    district: en,
    needles: [en.toLowerCase(), bn],
    isDivisionSeat: en === division,
  }))
);

/**
 * Returns { division, district } for the district named in `address`, or null when none is named.
 * WHY a division's seat loses to any other district: an address often ends with the division's
 * city ("Chashara, Narayanganj, Dhaka", "Feni, Chattogram"), so it names two districts, and the
 * other one is where the parcel goes. Between two other districts the longer name wins.
 */
export function findDistrict(address) {
  if (!address || typeof address !== 'string') return null;
  const hay = address.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const entry of ENTRIES) {
    for (const needle of entry.needles) {
      const score = (entry.isDivisionSeat ? 0 : 1000) + needle.length;
      if (score > bestScore && hay.includes(needle)) {
        best = entry;
        bestScore = score;
      }
    }
  }
  return best ? { division: best.division, district: best.district } : null;
}
