/**
 * bangladeshGeo.js — Complete administrative hierarchy of Bangladesh (Prompt 5.4).
 *
 * Contains all 8 Divisions and 64 Districts with primary Upazilas/Thanas in bilingual format (en/bn).
 */

export const BANGLADESH_DIVISIONS = [
  {
    id: 'dhaka',
    name_en: 'Dhaka',
    name_bn: 'ঢাকা',
    districts: [
      { id: 'dhaka_city', name_en: 'Dhaka City', name_bn: 'ঢাকা শহর', upazilas: ['Dhanmondi', 'Gulshan', 'Banani', 'Uttara', 'Mirpur', 'Mohammadpur', 'Badda', 'Motijheel', 'Old Dhaka', 'Tejgaon', 'Khilgaon', 'Bashundhara'] },
      { id: 'gazipur', name_en: 'Gazipur', name_bn: 'গাজীপুর', upazilas: ['Gazipur Sadar', 'Kaliakair', 'Kapasia', 'Sreepur', 'Kaliganj', 'Tongi'] },
      { id: 'narayanganj', name_en: 'Narayanganj', name_bn: 'নারায়ণগঞ্জ', upazilas: ['Narayanganj Sadar', 'Bandar', 'Rupganj', 'Sonargaon', 'Araihazar'] },
      { id: 'tangail', name_en: 'Tangail', name_bn: 'টাঙ্গাইল', upazilas: ['Tangail Sadar', 'Gopalpur', 'Ghatail', 'Madhupur', 'Mirzapur', 'Sakhipur', 'Kalihati', 'Delduar'] },
      { id: 'faridpur', name_en: 'Faridpur', name_bn: 'ফরিদপুর', upazilas: ['Faridpur Sadar', 'Boalmari', 'Alfadanga', 'Madhukhali', 'Bhanga', 'Nagarkanda', 'Charbhadrasan', 'Sadarpur'] },
      { id: 'manikganj', name_en: 'Manikganj', name_bn: 'মানিকগঞ্জ', upazilas: ['Manikganj Sadar', 'Singair', 'Saturia', 'Shibalaya', 'Ghior', 'Harirampur', 'Daulatpur'] },
      { id: 'munshiganj', name_en: 'Munshiganj', name_bn: 'মুন্সীগঞ্জ', upazilas: ['Munshiganj Sadar', 'Sreenagar', 'Sirajdikhan', 'Louhajang', 'Tongibari', 'Gazaria'] },
      { id: 'narsingdi', name_en: 'Narsingdi', name_bn: 'নরসিংদী', upazilas: ['Narsingdi Sadar', 'Palash', 'Belabo', 'Monohardi', 'Shibpur', 'Raipura'] },
      { id: 'kishoreganj', name_en: 'Kishoreganj', name_bn: 'কিশোরগঞ্জ', upazilas: ['Kishoreganj Sadar', 'Bhairab', 'Bajitpur', 'Katiadi', 'Kuliarchar', 'Pakundia', 'Nikli', 'Karimganj'] },
      { id: 'gopalganj', name_en: 'Gopalganj', name_bn: 'গোপালগঞ্জ', upazilas: ['Gopalganj Sadar', 'Kashiani', 'Kotalipara', 'Muksudpur', 'Tungipara'] },
      { id: 'madaripur', name_en: 'Madaripur', name_bn: 'মাদারীপুর', upazilas: ['Madaripur Sadar', 'Shibchar', 'Kalkini', 'Rajoir'] },
      { id: 'rajbari', name_en: 'Rajbari', name_bn: 'রাজবাড়ী', upazilas: ['Rajbari Sadar', 'Goalanda', 'Pangsha', 'Baliakandi', 'Kalukhali'] },
      { id: 'shariatpur', name_en: 'Shariatpur', name_bn: 'শরীয়তপুর', upazilas: ['Shariatpur Sadar', 'Naria', 'Zajira', 'Bhedarganj', 'Damudya', 'Gosairhat'] },
    ],
  },
  {
    id: 'chittagong',
    name_en: 'Chattogram',
    name_bn: 'চট্টগ্রাম',
    districts: [
      { id: 'chittagong_city', name_en: 'Chattogram City', name_bn: 'চট্টগ্রাম শহর', upazilas: ['Kotwali', 'Panchlaish', 'Agrabad', 'Khulshi', 'Halishahar', 'Bakalia', 'Chandgaon', 'Pahartali', 'Patenga', 'Double Mooring'] },
      { id: 'coxs_bazar', name_en: "Cox's Bazar", name_bn: 'কক্সবাজার', upazilas: ["Cox's Bazar Sadar", 'Ramu', 'Teknaf', 'Ukhia', 'Chakaria', 'Pekua', 'Kutubdia', 'Maheshkhali'] },
      { id: 'cumilla', name_en: 'Cumilla', name_bn: 'কুমিল্লা', upazilas: ['Cumilla Adarsha Sadar', 'Cumilla Sadar Dakshin', 'Daudkandi', 'Chandina', 'Debidwar', 'Homna', 'Laksam', 'Burichang', 'Brahmanpara', 'Chauddagram', 'Muradnagar'] },
      { id: 'brahmanbaria', name_en: 'Brahmanbaria', name_bn: 'ব্রাহ্মণবাড়িয়া', upazilas: ['Brahmanbaria Sadar', 'Ashuganj', 'Sarail', 'Nasirnagar', 'Nabinagar', 'Bancharampur', 'Kasba', 'Akhaura'] },
      { id: 'chandpur', name_en: 'Chandpur', name_bn: 'চাঁদপুর', upazilas: ['Chandpur Sadar', 'Faridganj', 'Hajiganj', 'Haimchar', 'Kachua', 'Matlab Dakshin', 'Matlab Uttar', 'Shahrasti'] },
      { id: 'feni', name_en: 'Feni', name_bn: 'ফেনী', upazilas: ['Feni Sadar', 'Chhagalnaiya', 'Daganbhuiyan', 'Parshuram', 'Fulgazi', 'Sonagazi'] },
      { id: 'noakhali', name_en: 'Noakhali', name_bn: 'নোয়াখালী', upazilas: ['Noakhali Sadar', 'Begumganj', 'Chatkhil', 'Companiganj', 'Hatiya', 'Senbagh', 'Subarnachar', 'Kabirhat'] },
      { id: 'lakshmipur', name_en: 'Lakshmipur', name_bn: 'লক্ষ্মীপুর', upazilas: ['Lakshmipur Sadar', 'Raipur', 'Ramganj', 'Ramgati', 'Kamalnagar'] },
      { id: 'khagrachhari', name_en: 'Khagrachhari', name_bn: 'খাগড়াছড়ি', upazilas: ['Khagrachhari Sadar', 'Dighinala', 'Panchhari', 'Mahalchhari', 'Matiranga', 'Manikchhari', 'Ramgarh', 'Guimara'] },
      { id: 'rangamati', name_en: 'Rangamati', name_bn: 'রাঙ্গামাটি', upazilas: ['Rangamati Sadar', 'Kaptai', 'Baghachhari', 'Barkal', 'Langadu', 'Rajasthali', 'Belaichhari', 'Juraichhari', 'Naniarchar'] },
      { id: 'bandarban', name_en: 'Bandarban', name_bn: 'বান্দরবান', upazilas: ['Bandarban Sadar', 'Rowangchhari', 'Ruma', 'Thanchi', 'Lama', 'Alikadam', 'Naikhongchhari'] },
    ],
  },
  {
    id: 'rajshahi',
    name_en: 'Rajshahi',
    name_bn: 'রাজশাহী',
    districts: [
      { id: 'rajshahi_city', name_en: 'Rajshahi City', name_bn: 'রাজশাহী শহর', upazilas: ['Boalia', 'Rajpara', 'Motihar', 'Shah Makhdum', 'Paba', 'Durgapur', 'Bagmara', 'Charghat', 'Puthia', 'Bagha', 'Godagari', 'Tanore', 'Mohanpur'] },
      { id: 'bogura', name_en: 'Bogura', name_bn: 'বগুড়া', upazilas: ['Bogura Sadar', 'Adamdighi', 'Dhunat', 'Dhupchanchia', 'Gabtali', 'Kahaloo', 'Nandigram', 'Sariakandi', 'Shajahanpur', 'Sherpur', 'Shibganj', 'Sonatala'] },
      { id: 'pabna', name_en: 'Pabna', name_bn: 'পাবনা', upazilas: ['Pabna Sadar', 'Atgharia', 'Bera', 'Bhangura', 'Chatmohar', 'Faridpur', 'Ishwardi', 'Santhia', 'Sujanagar'] },
      { id: 'sirajganj', name_en: 'Sirajganj', name_bn: 'সিরাজগঞ্জ', upazilas: ['Sirajganj Sadar', 'Belkuchi', 'Chauhali', 'Kamarkhanda', 'Kazipur', 'Raiganj', 'Shahjadpur', 'Tarash', 'Ullapara'] },
      { id: 'naogaon', name_en: 'Naogaon', name_bn: 'নওগাঁ', upazilas: ['Naogaon Sadar', 'Atrai', 'Badalgachhi', 'Dhamoirhat', 'Manda', 'Mohadevpur', 'Niamatpur', 'Patnitala', 'Porsha', 'Raninagar', 'Sapahar'] },
      { id: 'natore', name_en: 'Natore', name_bn: 'নাটোর', upazilas: ['Natore Sadar', 'Bagatipara', 'Baraigram', 'Gurudaspur', 'Lalpur', 'Singra', 'Naldanga'] },
      { id: 'chapainawabganj', name_en: 'Chapainawabganj', name_bn: 'চাঁপাইনবাবগঞ্জ', upazilas: ['Chapainawabganj Sadar', 'Gomastapur', 'Nachole', 'Bholahat', 'Shibganj'] },
      { id: 'joypurhat', name_en: 'Joypurhat', name_bn: 'জয়পুরহাট', upazilas: ['Joypurhat Sadar', 'Akkelpur', 'Kalai', 'Khetlal', 'Panchbibi'] },
    ],
  },
  {
    id: 'khulna',
    name_en: 'Khulna',
    name_bn: 'খুলনা',
    districts: [
      { id: 'khulna_city', name_en: 'Khulna City', name_bn: 'খুলনা শহর', upazilas: ['Kotwali', 'Sonadanga', 'Khalishpur', 'Daulatpur', 'Khan Jahan Ali', 'Batiaghata', 'Dacope', 'Dumuria', 'Dighalia', 'Koyra', 'Paikgachha', 'Phultala', 'Rupsha', 'Terokhada'] },
      { id: 'jashore', name_en: 'Jashore', name_bn: 'যশোর', upazilas: ['Jashore Sadar', 'Abhaynagar', 'Bagherpara', 'Chaugachha', 'Jhikargachha', 'Keshabpur', 'Manirampur', 'Sharsha'] },
      { id: 'kushtia', name_en: 'Kushtia', name_bn: 'কুষ্টিয়া', upazilas: ['Kushtia Sadar', 'Kumarkhali', 'Daulatpur', 'Mirpur', 'Bheramara', 'Khoksa'] },
      { id: 'satkhira', name_en: 'Satkhira', name_bn: 'সাতক্ষীরা', upazilas: ['Satkhira Sadar', 'Assasuni', 'Debhata', 'Kalaroa', 'Kaliganj', 'Shyamnagar', 'Tala'] },
      { id: 'bagerhat', name_en: 'Bagerhat', name_bn: 'বাগেরহাট', upazilas: ['Bagerhat Sadar', 'Chitalmari', 'Fakirhat', 'Kachua', 'Mollahat', 'Mongla', 'Morrelganj', 'Rampal', 'Sarankhola'] },
      { id: 'jhenaidah', name_en: 'Jhenaidah', name_bn: 'ঝিনাইদহ', upazilas: ['Jhenaidah Sadar', 'Harinakunda', 'Kaliganj', 'Kotchandpur', 'Maheshpur', 'Shailkupa'] },
      { id: 'chuadanga', name_en: 'Chuadanga', name_bn: 'চুয়াডাঙ্গা', upazilas: ['Chuadanga Sadar', 'Alamdanga', 'Damurhuda', 'Jibannagar'] },
      { id: 'magura', name_en: 'Magura', name_bn: 'মাগুরা', upazilas: ['Magura Sadar', 'Mohammadpur', 'Shalikha', 'Sreepur'] },
      { id: 'meherpur', name_en: 'Meherpur', name_bn: 'মেহেরপুর', upazilas: ['Meherpur Sadar', 'Gangni', 'Mujibnagar'] },
      { id: 'narail', name_en: 'Narail', name_bn: 'নড়াইল', upazilas: ['Narail Sadar', 'Kalia', 'Lohagara'] },
    ],
  },
  {
    id: 'barisal',
    name_en: 'Barishal',
    name_bn: 'বরিশাল',
    districts: [
      { id: 'barisal_city', name_en: 'Barishal City', name_bn: 'বরিশাল শহর', upazilas: ['Kotwali', 'Barishal Sadar', 'Bakerganj', 'Babuganj', 'Banaripara', 'Gournadi', 'Hizla', 'Mehendiganj', 'Muladi', 'Wazirpur', 'Agailjhara'] },
      { id: 'bhola', name_en: 'Bhola', name_bn: 'ভোলা', upazilas: ['Bhola Sadar', 'Burhanuddin', 'Char Fasson', 'Daulatkhan', 'Lalmohan', 'Manpura', 'Tazumuddin'] },
      { id: 'patuakhali', name_en: 'Patuakhali', name_bn: 'পটুয়াখালী', upazilas: ['Patuakhali Sadar', 'Bauphal', 'Dashmina', 'Galachipa', 'Kalapara', 'Mirzaganj', 'Dumki', 'Rangabali'] },
      { id: 'pirojpur', name_en: 'Pirojpur', name_bn: 'পিরোজপুর', upazilas: ['Pirojpur Sadar', 'Bhandaria', 'Kawkhali', 'Mathbaria', 'Nazirpur', 'Nesarabad', 'Indurkani'] },
      { id: 'barguna', name_en: 'Barguna', name_bn: 'বরগুনা', upazilas: ['Barguna Sadar', 'Amtali', 'Bamna', 'Betagi', 'Patharghata', 'Taltali'] },
      { id: 'jhalokathi', name_en: 'Jhalokathi', name_bn: 'ঝালকাঠি', upazilas: ['Jhalokathi Sadar', 'Kathalia', 'Nalchity', 'Rajapur'] },
    ],
  },
  {
    id: 'sylhet',
    name_en: 'Sylhet',
    name_bn: 'সিলেট',
    districts: [
      { id: 'sylhet_city', name_en: 'Sylhet City', name_bn: 'সিলেট শহর', upazilas: ['Kotwali', 'Sylhet Sadar', 'Beanibazar', 'Bishwanath', 'Dakshin Surma', 'Fenchuganj', 'Golapganj', 'Gowainghat', 'Jaintiapur', 'Kanaighat', 'Companiganj', 'Zakiganj', 'Osmani Nagar'] },
      { id: 'moulvibazar', name_en: 'Moulvibazar', name_bn: 'মৌলভীবাজার', upazilas: ['Moulvibazar Sadar', 'Barlekha', 'Juri', 'Kamalganj', 'Kulaura', 'Rajnagar', 'Sreemangal'] },
      { id: 'habiganj', name_en: 'Habiganj', name_bn: 'হবিগঞ্জ', upazilas: ['Habiganj Sadar', 'Ajmiriganj', 'Bahubal', 'Baniachong', 'Chunarughat', 'Lakhai', 'Madhabpur', 'Nabiganj', 'Sayestaganj'] },
      { id: 'sunamganj', name_en: 'Sunamganj', name_bn: 'সুনামগঞ্জ', upazilas: ['Sunamganj Sadar', 'Bishwamvarpur', 'Chhatak', 'Derai', 'Dharampasha', 'Dowarabazar', 'Jagannathpur', 'Jamalganj', 'Sullah', 'Tahirpur', 'South Sunamganj'] },
    ],
  },
  {
    id: 'rangpur',
    name_en: 'Rangpur',
    name_bn: 'রংপুর',
    districts: [
      { id: 'rangpur_city', name_en: 'Rangpur City', name_bn: 'রংপুর শহর', upazilas: ['Kotwali', 'Rangpur Sadar', 'Badarganj', 'Gangachhara', 'Kaunia', 'Mithapukur', 'Pirgachha', 'Pirganj', 'Taraganj'] },
      { id: 'dinajpur', name_en: 'Dinajpur', name_bn: 'দিনাজপুর', upazilas: ['Dinajpur Sadar', 'Birampur', 'Birganj', 'Biral', 'Bochaganj', 'Chirirbandar', 'Fulbari', 'Ghoraghat', 'Hakimpur', 'Kaharole', 'Khansama', 'Nawabganj', 'Parbatipur'] },
      { id: 'gaibandha', name_en: 'Gaibandha', name_bn: 'গাইবান্ধা', upazilas: ['Gaibandha Sadar', 'Fulchhari', 'Gobindaganj', 'Palashbari', 'Sadullapur', 'Saghata', 'Sundarganj'] },
      { id: 'kurigram', name_en: 'Kurigram', name_bn: 'কুড়িগ্রাম', upazilas: ['Kurigram Sadar', 'Bhurungamari', 'Char Rajibpur', 'Chilmari', 'Phulbari', 'Nageshwari', 'Rajarhat', 'Raomari', 'Ulipur'] },
      { id: 'nilphamari', name_en: 'Nilphamari', name_bn: 'নীলফামারী', upazilas: ['Nilphamari Sadar', 'Dimla', 'Domar', 'Jaldhaka', 'Kishoreganj', 'Saidpur'] },
      { id: 'panchagarh', name_en: 'Panchagarh', name_bn: 'পঞ্চগড়', upazilas: ['Panchagarh Sadar', 'Atwari', 'Boda', 'Debiganj', 'Tetulia'] },
      { id: 'thakurgaon', name_en: 'Thakurgaon', name_bn: 'ঠাকুরগাঁও', upazilas: ['Thakurgaon Sadar', 'Baliadangi', 'Haripur', 'Pirganj', 'Ranisankail'] },
      { id: 'lalmonirhat', name_en: 'Lalmonirhat', name_bn: 'লালমনিরহাট', upazilas: ['Lalmonirhat Sadar', 'Aditmari', 'Hatibandha', 'Kaliganj', 'Patgram'] },
    ],
  },
  {
    id: 'mymensingh',
    name_en: 'Mymensingh',
    name_bn: 'ময়মনসিংহ',
    districts: [
      { id: 'mymensingh_city', name_en: 'Mymensingh City', name_bn: 'ময়মনসিংহ শহর', upazilas: ['Kotwali', 'Mymensingh Sadar', 'Bhaluka', 'Trishal', 'Haluaghat', 'Muktagachha', 'Dhobaura', 'Fulbaria', 'Gaffargaon', 'Gauripur', 'Ishwarganj', 'Nandail', 'Phulpur', 'Tara Khanda'] },
      { id: 'jamalpur', name_en: 'Jamalpur', name_bn: 'জামালপুর', upazilas: ['Jamalpur Sadar', 'Baksiganj', 'Dewanganj', 'Islampur', 'Madarganj', 'Melandaha', 'Sarishabari'] },
      { id: 'netrokona', name_en: 'Netrokona', name_bn: 'নেত্রকোণা', upazilas: ['Netrokona Sadar', 'Atpara', 'Barhatta', 'Durgapur', 'Kalmakanda', 'Kendua', 'Madan', 'Mohanganj', 'Purbadhala', 'Khaliajuri'] },
      { id: 'sherpur', name_en: 'Sherpur', name_bn: 'শেরপুর', upazilas: ['Sherpur Sadar', 'Jhenaigati', 'Nakla', 'Nalitabari', 'Sreebardi'] },
    ],
  },
];

export function getDivisions() {
  return BANGLADESH_DIVISIONS;
}

export function getDivisionById(divisionId) {
  if (!divisionId) return null;
  const match = BANGLADESH_DIVISIONS.find((d) => d.id === divisionId || d.name_en.toLowerCase() === divisionId.toLowerCase());
  return match || null;
}

export function getDistrictsByDivision(divisionId) {
  const div = getDivisionById(divisionId);
  return div ? div.districts : [];
}

export function getDistrictById(divisionId, districtId) {
  const districts = getDistrictsByDivision(divisionId);
  return districts.find((d) => d.id === districtId || d.name_en.toLowerCase() === districtId.toLowerCase()) || null;
}

export function getUpazilasByDistrict(divisionId, districtId) {
  const dist = getDistrictById(divisionId, districtId);
  return dist ? dist.upazilas : [];
}
