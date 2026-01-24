const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const locations = [
  "KINGSPORT","LEE HWY","ABINGDON","CHURCH HILL","BLOUNTVILLE","DAMASCUS","BLUFF CITY",
  "BLOOMINGDALE","ROGERSVILLE","ERWIN","WEAVER PIKE","NEW TAZEWELL","PENNINGTON GAP",
  "CLAYPOOL HILL","BIG STONE GAP","RUTLEDGE","NICKELSVILLE","PEARISBURG","RICH CREEK",
  "FOUR WAY","DANDRIDGE","RURAL RETREAT","WHITE PINE","HAYSI","SNEEDVILLE","BEAN STATION",
  "MOSHEIM","MOUNTAIN CITY","FALL BRANCH","LUTTRELL","RUSSELVILLE","GRUNDY","LEBANON",
  "NORTH TAZEWELL","GATE CITY","BLAINE","BAILEYTON","DUFFIELD","HONAKER","CLINTWOOD",
  "ST PAUL","POUND","BULLS GAP","PARROTTSVILLE","AIRPORT PKWY","CORPORATE","GARAGE"
];

async function main() {
  for (const name of locations) {
    await prisma.location.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`Seeded ${locations.length} locations`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
