# Dragon Ball Z — Text RPG

Aventura narrativa interativa feita com HTML, CSS e JavaScript. Não precisa instalar dependências nem iniciar um terminal para jogar: abra `index.html` em um navegador moderno.

## Publicar para outras pessoas

O jogo pode ser publicado como um site interativo em um serviço de hospedagem web. Para fazer isso sem usar o terminal:

1. Entre em [Netlify Drop](https://app.netlify.com/drop) e crie uma conta ou entre na sua conta.
2. Arraste a pasta `dragon-ball-rpg` inteira para a área de publicação.
3. Compartilhe o endereço público gerado pelo Netlify.

O jogo continua interativo depois de publicado: combate por turnos, decisões, níveis, técnicas, transformações e telas de apoio são executados no navegador. Cada jogador mantém seu próprio save no armazenamento local do navegador. Para sincronizar saves entre dispositivos ou criar contas compartilhadas, seria necessário adicionar um backend.

## Conteúdo

A primeira campanha acompanha a Saga Saiyajin, da chegada de Raditz ao confronto em fases com Vegeta. Inclui criação de personagem, treinamento, escolhas, relações, combate, itens, progressão, codex, diário e salvamento. Após a campanha, um treino opcional permite experimentar a transformação desbloqueada.

Os dados de personagens, inimigos, técnicas, transformações e capítulos estão separados em `data/` para facilitar a expansão.
