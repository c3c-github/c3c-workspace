const fs = require('fs');
const path = require('path');

function checkFrontendSanity() {
    const filePath = path.join(__dirname, '..', 'views', 'services.ejs');
    const content = fs.readFileSync(filePath, 'utf8');
    
    console.log("🔍 Verificando integridade de views/services.ejs...");
    
    let errors = 0;

    // 1. Verificar duplicação de tags estruturais
    const htmlTags = (content.match(/<html/gi) || []).length;
    const bodyTags = (content.match(/<body/gi) || []).length;
    
    if (htmlTags > 1) { console.error(`❌ Erro: Tag <html> aparece ${htmlTags} vezes.`); errors++; }
    if (bodyTags > 1) { console.error(`❌ Erro: Tag <body> aparece ${bodyTags} vezes.`); errors++; }

    // 2. Verificar se o arquivo termina abruptamente
    if (!content.trim().endsWith('</html>')) {
        console.error("❌ Erro: O arquivo não termina com </html>. Possível truncamento.");
        errors++;
    }

    // 3. Verificar variáveis duplicadas em blocos conhecidos (Regex simples)
    const lines = content.split('\n');
    const seenConsts = new Set();
    let currentFunction = "";

    lines.forEach((line, i) => {
        if (line.includes('function ')) currentFunction = line.trim();
        const match = line.match(/const\s+([a-zA-Z0-9_]+)\s*=/);
        if (match) {
            const varName = match[1];
            // Simplificação: apenas checar se a mesma linha ou linhas adjacentes tem a mesma const
            if (lines[i-1] && lines[i-1].includes(`const ${varName} =`)) {
                console.error(`❌ Erro: Variável '${varName}' declarada em linhas seguidas (Linha ${i+1}).`);
                errors++;
            }
        }
    });

    if (errors === 0) {
        console.log("✅ Integridade do frontend OK!");
    } else {
        console.error(`\n🚨 Foram encontrados ${errors} erros no frontend.`);
        process.exit(1);
    }
}

checkFrontendSanity();
