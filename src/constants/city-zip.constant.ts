export const DEFAULT_CITY_ZIPS = [
  { city: "Mumbai", zipCode: "400001" },
  { city: "Delhi", zipCode: "110001" },
  { city: "Bengaluru", zipCode: "560001" },
  { city: "Hyderabad", zipCode: "500001" },
  { city: "Chennai", zipCode: "600001" },
  { city: "Kolkata", zipCode: "700001" },
  { city: "Pune", zipCode: "411001" },
  { city: "Ahmedabad", zipCode: "380001" },
  { city: "Jaipur", zipCode: "302001" },
  { city: "Surat", zipCode: "395003" },
];

export const pickRandomCityZip = () => {
  const idx = Math.floor(Math.random() * DEFAULT_CITY_ZIPS.length);
  return DEFAULT_CITY_ZIPS[idx];
};
