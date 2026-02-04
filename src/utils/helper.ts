import { faker } from '@faker-js/faker';

export function generateRandomPassword() {
  const word = Math.random() < 0.5
    ? faker.location.city().split(" ")[0]   // city (first word only)
    : faker.animal.type().split(" ")[0];                  // animal

  const symbol = ["!", "@", "#", "$", "%", "&", "*"][Math.floor(Math.random() * 7)];
  const number = Math.floor(1000 + Math.random() * 9000);

  return `${word}${symbol}${number}`;
}


