export interface DistrictInfo {
  name: string;
  province: string;
  lat: number;
  lng: number;
}

export const PROVINCES = [
  "Kigali City",
  "Southern Province",
  "Western Province",
  "Northern Province",
  "Eastern Province",
] as const;

export const DISTRICTS: DistrictInfo[] = [
  { name: "Nyarugenge", province: "Kigali City", lat: -1.95, lng: 30.05 },
  { name: "Gasabo", province: "Kigali City", lat: -1.9, lng: 30.12 },
  { name: "Kicukiro", province: "Kigali City", lat: -1.99, lng: 30.1 },
  { name: "Nyanza", province: "Southern Province", lat: -2.35, lng: 29.75 },
  { name: "Gisagara", province: "Southern Province", lat: -2.62, lng: 29.83 },
  { name: "Nyaruguru", province: "Southern Province", lat: -2.63, lng: 29.55 },
  { name: "Huye", province: "Southern Province", lat: -2.6, lng: 29.74 },
  { name: "Nyamagabe", province: "Southern Province", lat: -2.47, lng: 29.44 },
  { name: "Ruhango", province: "Southern Province", lat: -2.17, lng: 29.78 },
  { name: "Muhanga", province: "Southern Province", lat: -2.08, lng: 29.75 },
  { name: "Kamonyi", province: "Southern Province", lat: -2.0, lng: 29.9 },
  { name: "Karongi", province: "Western Province", lat: -2.06, lng: 29.36 },
  { name: "Rutsiro", province: "Western Province", lat: -1.86, lng: 29.33 },
  { name: "Rubavu", province: "Western Province", lat: -1.68, lng: 29.26 },
  { name: "Nyabihu", province: "Western Province", lat: -1.65, lng: 29.51 },
  { name: "Ngororero", province: "Western Province", lat: -1.87, lng: 29.61 },
  { name: "Rusizi", province: "Western Province", lat: -2.48, lng: 28.91 },
  { name: "Nyamasheke", province: "Western Province", lat: -2.35, lng: 29.13 },
  { name: "Rulindo", province: "Northern Province", lat: -1.77, lng: 29.99 },
  { name: "Gakenke", province: "Northern Province", lat: -1.7, lng: 29.78 },
  { name: "Musanze", province: "Northern Province", lat: -1.5, lng: 29.63 },
  { name: "Burera", province: "Northern Province", lat: -1.47, lng: 29.86 },
  { name: "Gicumbi", province: "Northern Province", lat: -1.58, lng: 30.11 },
  { name: "Rwamagana", province: "Eastern Province", lat: -1.95, lng: 30.43 },
  { name: "Nyagatare", province: "Eastern Province", lat: -1.29, lng: 30.33 },
  { name: "Gatsibo", province: "Eastern Province", lat: -1.58, lng: 30.42 },
  { name: "Kayonza", province: "Eastern Province", lat: -1.88, lng: 30.62 },
  { name: "Kirehe", province: "Eastern Province", lat: -2.26, lng: 30.71 },
  { name: "Ngoma", province: "Eastern Province", lat: -2.16, lng: 30.46 },
  { name: "Bugesera", province: "Eastern Province", lat: -2.21, lng: 30.19 },
];
