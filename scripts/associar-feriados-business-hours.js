require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    console.log("🔗 Associando feriados ao Business Hours 'Default'...");

    try {
        // 1. Busca o Business Hours 'Default'
        const bhRes = await conn.query("SELECT Id FROM BusinessHours WHERE IsDefault = true OR Name = 'Default' LIMIT 1");
        if (bhRes.totalSize === 0) {
            console.error("❌ Business Hours 'Default' não encontrado.");
            return;
        }
        const bhId = bhRes.records[0].Id;
        console.log(`BH ID: ${bhId}`);

        // 2. Busca feriados de 2026
        const hRes = await conn.query("SELECT Id, Name FROM Holiday WHERE ActivityDate >= 2026-01-01");
        if (hRes.totalSize === 0) {
            console.error("❌ Nenhum feriado encontrado para 2026.");
            return;
        }

        // 3. Verifica associações existentes
        const existingRes = await conn.query(`SELECT HolidayId FROM BusinessHoursHoliday WHERE BusinessHoursId = '${bhId}'`);
        const existingIds = new Set(existingRes.records.map(r => r.HolidayId));

        const toCreate = hRes.records
            .filter(h => !existingIds.has(h.Id))
            .map(h => ({
                BusinessHoursId: bhId,
                HolidayId: h.Id
            }));

        if (toCreate.length === 0) {
            console.log("✅ Todos os feriados já estão associados ao Business Hours Default.");
            return;
        }

        const ret = await conn.sobject('BusinessHoursHoliday').create(toCreate);
        console.log(`✅ ${ret.filter(r => r.success).length} associações criadas.`);

    } catch (e) {
        console.error("❌ Erro:", e.message);
    }
}

run();
