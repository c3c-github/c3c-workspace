require('dotenv').config();
const contaAzulService = require('../src/services/contaAzulService');

async function research() {
    console.log("--- PESQUISA DE DADOS CONTA AZUL ---");
    try {
        // 1. Buscar alguns clientes
        const customers = await contaAzulService.searchCustomers('');
        if (customers.length === 0) {
            console.log("Nenhum cliente encontrado.");
            return;
        }

        const customer = customers[0];
        console.log(`Cliente selecionado: ${customer.name} (${customer.id})`);

        // 2. Buscar vendas desse cliente
        const sales = await contaAzulService.getSalesByCustomer(customer.id);
        if (sales.length === 0) {
            console.log("Nenhuma venda encontrada para este cliente.");
            return;
        }

        const sale = sales[0];
        console.log(`Venda selecionada: ${sale.number} - Total: ${sale.total}`);

        // 3. Buscar detalhes da venda (incluindo itens e evento financeiro)
        const token = await require('../src/services/contaAzulService').getValidToken ? 
                      await require('../src/services/contaAzulService').getValidToken() : null;
        
        if (!token) return;

        const axios = require('axios');
        const saleDetail = await axios.get(`https://api-v2.contaazul.com/v1/venda/${sale.id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        console.log("\n--- ESTRUTURA DA VENDA (DETALHADA) ---");
        console.log(JSON.stringify(saleDetail.data, null, 2));

        // 4. Buscar parcelas
        const installments = await contaAzulService.getSaleInstallments(sale.id);
        console.log("\n--- ESTRUTURA DAS PARCELAS ---");
        console.log(JSON.stringify(installments, null, 2));

    } catch (e) {
        console.error("Erro na pesquisa:", e.message);
        if (e.response) console.error("Data:", e.response.data);
    }
}

research();
