import type { LanguageData } from "./types";

const words = `de la que el en y a los se del las un por con no una su para es al lo como más pero sus le ya o fue este ha sí porque esta son entre está cuando muy sin sobre ser tiene también me hasta hay donde han quien están desde todo nos durante todos uno les ni contra otros fueron ese eso había ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual sea poco ella estar haber estas algunas algo nosotros mi mis tú te ti tu tus ellas vosotros os mío mía tuyo suyo nuestro vuestra esos esas estoy estás estamos están estaba estado hacer hecho tiempo día año vez casa mundo vida hombre mujer país ciudad parte gente forma caso lugar trabajo agua noche mano cosa padre madre hijo hija amigo libro palabra calle mesa puerta ventana camino tierra fuego aire cielo sol luna mar río montaña árbol flor perro gato pájaro comida pan leche café escuela maestro niño niña familia nombre historia música color rojo azul verde blanco negro grande pequeño nuevo viejo bueno malo largo corto alto bajo feliz triste fácil difícil rápido lento siempre nunca hoy mañana ayer ahora luego después tarde temprano aquí allí cerca lejos bien mal mejor peor decir ir ver dar saber querer llegar pasar deber poner parecer quedar creer hablar llevar dejar seguir encontrar llamar venir pensar salir volver tomar conocer vivir sentir tratar mirar contar empezar esperar buscar existir entrar trabajar escribir perder producir ocurrir entender pedir recibir recordar terminar permitir aparecer conseguir comenzar servir sacar necesitar mantener resultar leer caer cambiar presentar crear abrir considerar oír acabar convertir ganar formar traer partir morir aceptar realizar suponer comprender lograr explicar`.split(/\s+/);

export const spanish: LanguageData = {
  id: "spanish",
  name: "Spanish",
  nativeName: "Español",
  dir: "ltr",
  status: "full",
  hasCase: true,
  words,
  punctuation: { comma: ",", period: ".", question: "?", exclamation: "!", extra: [";", ":"], quotes: ["«", "»"], invertedQuestion: "¿", invertedExclamation: "¡" },
  quotes: [
    { id: "es-1", text: "En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua, rocín flaco y galgo corredor.", source: "Miguel de Cervantes, Don Quijote (1605)" },
    { id: "es-2", text: "Caminante, no hay camino, se hace camino al andar.", source: "Antonio Machado, Campos de Castilla (1912)" },
    { id: "es-3", text: "Más vale tarde que nunca.", source: "Refrán popular" },
    { id: "es-4", text: "No hay mal que por bien no venga.", source: "Refrán popular" },
    { id: "es-5", text: "Poco a poco se va lejos, y quien practica cada día escribe cada vez mejor.", source: "Monkeytype" },
  ],
};
