/**
 * ==============================================================================
 * Inicialização do Sistema - K-Off Kanban
 * Responsabilidade Única: Ponto de entrada para inicialização dos serviços
 * fundamentais da aplicação (persistência e armazenamento).
 * 
 * Por que solicitar armazenamento persistente logo no início?
 * Dispositivos móveis (iOS Safari, Android Chrome) podem liberar espaço em disco
 * excluindo automaticamente bancos de dados IndexedDB de aplicativos web caso o
 * usuário não os abra por alguns dias ou o disco fique cheio.
 * A API navigator.storage.persist() solicita explicitamente ao navegador que proteja
 * os dados do aplicativo contra limpeza automática.
 * ==============================================================================
 */

/**
 * Solicita que o navegador garanta que os dados locais não serão apagados automaticamente.
 * 
 * @returns {Promise<boolean>} Retorna verdadeiro se a persistência foi concedida.
 */
async function solicitarArmazenamentoPersistente() {
    if (navigator.storage && navigator.storage.persist) {
        try {
            const persistido = await navigator.storage.persist();
            if (persistido) {
                console.log("✅ Sistema garantiu: os dados do Kanban não serão apagados!");
            } else {
                // O popup deve aparecer quando estiver instalado no dispositivo como PWA.
                // Verificar se o app está instalado como PWA, senão mostrar mensagem para instalar como PWA.
                console.warn("⚠️ Armazenamento persistente recusado. O sistema pode limpar o app se o disco encher.");
            }
            return persistido;
        } catch (erro) {
            console.error("Erro ao solicitar armazenamento persistente:", erro);
            return false;
        }
    } else {
        console.info("ℹ️ A API de armazenamento persistente não é suportada neste navegador.");
        return false;
    }
}

/**
 * Função principal de inicialização da aplicação.
 */
async function inicializarAplicacao() {
    console.log("🚀 Inicializando K-Off Kanban...");

    // 1. Solicita armazenamento persistente
    await solicitarArmazenamentoPersistente();

    // 2. Cria a instância do Banco de Dados Local
    if (typeof BancoDeDadosLocal !== "undefined") {
        window.bancoDeDadosLocal = new BancoDeDadosLocal();
        console.log("📦 Banco de dados local inicializado com sucesso.");
    } else {
        console.error("❌ Classe BancoDeDadosLocal não encontrada. Verifique os scripts carregados.");
        return;
    }

    // 3. Inicializa o Gerenciador de Interface (Fase 3: DOM e CRUD)
    if (typeof GerenciadorDeInterface !== "undefined") {
        window.gerenciadorDeInterface = new GerenciadorDeInterface(window.bancoDeDadosLocal);
        window.gerenciadorDeInterface.inicializar();
        console.log("🖥️ Gerenciador de Interface inicializado com sucesso.");
    } else {
        console.error("❌ Classe GerenciadorDeInterface não encontrada. Verifique os scripts carregados.");
    }
}

// Executa a inicialização quando o DOM estiver pronto
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inicializarAplicacao);
} else {
    inicializarAplicacao();
}
