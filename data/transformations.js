window.TRANSFORMATIONS = {
  normal: { name: "Normal", multiplier: 1, kiDrain: 0, requirements: { level: 1, flag: null }, modifiers: { strength: 1, defense: 1, speed: 1, kiPower: 1 } },
  oozaru: { name: "Oozaru", multiplier: 5, kiDrain: 4, requirements: { level: 4, flag: "moon_awakening" }, modifiers: { strength: 1.8, defense: 1.5, speed: 0.75, kiPower: 1.25 } },
  super_saiyan: { name: "Super Saiyajin", multiplier: 50, kiDrain: 2, requirements: { level: 8, flag: "super_saiyan_awakened" }, modifiers: { strength: 1.5, defense: 1.2, speed: 1.35, kiPower: 1.6 } },
  super_saiyan_2: { name: "Super Saiyajin 2", multiplier: 100, kiDrain: 3, requirements: { level: 18, flag: "ssj2_awakened" }, modifiers: { strength: 1.8, defense: 1.35, speed: 1.55, kiPower: 1.9 } },
  super_saiyan_3: { name: "Super Saiyajin 3", multiplier: 400, kiDrain: 7, requirements: { level: 30, flag: "ssj3_awakened" }, modifiers: { strength: 2.2, defense: 1.5, speed: 1.8, kiPower: 2.4 } }
};
