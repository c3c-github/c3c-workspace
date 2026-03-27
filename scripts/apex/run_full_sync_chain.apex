// 1. Equalização (Síncrono)
System.debug('--- Iniciando Equalização de Orçamentos ---');
OrcamentoEqualizer.equalizeAllActive();
System.debug('✅ Equalização Concluída.');

// 2. Apuração de Custos (Batch)
System.debug('--- Iniciando Apuração de Custos (Horas) ---');
Database.executeBatch(new ApuracaoCustosBatch(), 200);

// 3. Sincronização Conta Azul (Batch com Callouts)
System.debug('--- Iniciando Sincronização de Receitas (ERP) ---');
Database.executeBatch(new ContaAzulSyncBatch(), 50);

System.debug('🚀 Cadeia de sincronização disparada com sucesso!');
