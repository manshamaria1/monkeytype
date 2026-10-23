import type { LanguageData } from "./types";

const words = `de a o que e do da em um para com não uma os no se na por mais as dos como mas ao ele das à seu sua ou quando muito nos já eu também só pelo pela até isso ela entre depois sem mesmo aos seus quem nas me esse eles você essa num nem suas meu às minha numa pelos elas qual nós lhe deles essas esses pelas este dele tu te vocês vos lhes meus minhas teu tua teus tuas nosso nossa nossos nossas dela delas esta estes estas aquele aquela aqueles aquelas isto aquilo estou está estamos estão estive esteve estivemos estiveram estava ser ter fazer dizer poder ir ver dar saber querer chegar passar ficar deixar parecer levar começar vir pensar viver sentir olhar trabalhar escrever ler falar ouvir abrir fechar comer beber dormir andar correr jogar estudar aprender ensinar casa tempo dia ano vez mundo vida homem mulher país cidade parte gente forma caso lugar trabalho água noite mão coisa pai mãe filho filha amigo livro palavra rua mesa porta janela caminho terra fogo ar céu sol lua mar rio árvore flor cão gato pássaro comida pão leite café escola professor criança família nome história música cor vermelho azul verde branco preto grande pequeno novo velho bom mau longo curto alto baixo feliz triste fácil difícil rápido devagar sempre nunca hoje amanhã ontem agora aqui ali perto longe bem mal melhor pior`.split(/\s+/);

export const portuguese: LanguageData = {
  id: "portuguese",
  name: "Portuguese",
  nativeName: "Português",
  dir: "ltr",
  status: "full",
  hasCase: true,
  words: [...new Set(words)],
  punctuation: { comma: ",", period: ".", question: "?", exclamation: "!", extra: [";", ":"], quotes: ["“", "”"] },
  quotes: [
    { id: "pt-1", text: "As armas e os barões assinalados, que da ocidental praia lusitana, por mares nunca de antes navegados, passaram ainda além da Taprobana.", source: "Luís de Camões, Os Lusíadas (1572)" },
    { id: "pt-2", text: "Água mole em pedra dura, tanto bate até que fura.", source: "Provérbio" },
    { id: "pt-3", text: "Devagar se vai ao longe.", source: "Provérbio" },
    { id: "pt-4", text: "Navegar é preciso; viver não é preciso.", source: "Provérbio antigo" },
    { id: "pt-5", text: "Quem treina um pouco todos os dias escreve cada vez mais rápido e com menos erros.", source: "Monkeytype" },
  ],
};
