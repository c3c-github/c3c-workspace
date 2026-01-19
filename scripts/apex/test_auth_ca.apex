try {
    ContaAzulAuthService.AuthResult res = ContaAzulAuthService.getAuthentication();
    System.debug('SUCESSO: Token obtido: ' + res.accessToken);
} catch (Exception e) {
    System.debug('ERRO: ' + e.getMessage());
}