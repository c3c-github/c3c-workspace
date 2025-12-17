@RestResource(urlMapping='/AuthContrato/*')
global with sharing class ValidadorAcessoService {

    @HttpPost
    global static ResponseWrapper validarAcesso(String emailUsuario) {
        ResponseWrapper resp = new ResponseWrapper();
        
        try {
            // Busca Contrato Ativo vinculado à Pessoa com este email
            List<contratopessoa__c> contratos = [
                SELECT Id, Pessoa__r.Name, Name, Status__c // Assumindo Numero_Contrato__c como campo
                FROM contratopessoa__c 
                WHERE Pessoa__r.Email__c = :emailUsuario 
                AND Status__c = 'Ativo'
                LIMIT 1
            ];

            if (!contratos.isEmpty()) {
                resp.acessoPermitido = true;
                resp.nomeUsuario = contratos[0].Pessoa__r.Name;
                resp.numeroContrato = contratos[0].Name;
            } else {
                resp.acessoPermitido = false;
                resp.mensagem = 'Nenhum contrato ativo encontrado.';
            }
            
        } catch (Exception e) {
            resp.acessoPermitido = false;
            resp.mensagem = 'Erro interno: ' + e.getMessage();
        }
        
        return resp;
    }
    
    global class ResponseWrapper {
        public Boolean acessoPermitido;
        public String nomeUsuario;
        public String numeroContrato;
        public String mensagem;
    }
}