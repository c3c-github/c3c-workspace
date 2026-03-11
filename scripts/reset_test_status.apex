Id periodId = 'a1EN5000002Gw25MAC';

// 1. Abrir o período para permitir novo envio
update new Periodo__c(Id = periodId, Status__c = 'Aberto');

// 2. Excluir Notas Fiscais existentes para limpar o estado
delete [SELECT Id FROM NotaFiscal__c WHERE Periodo__c = :periodId];

System.debug('Teste resetado para status Aberto/Rascunho para novo envio.');
