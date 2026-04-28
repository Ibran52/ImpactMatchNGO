const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI("AIzaSyC45at-RM1IGqqf2NS8xdKewaLvxhWg9K0");

async function test() {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
    const result = await model.generateContent("Say hello");
    console.log(result.response.text());
  } catch (e) {
    console.error(e);
  }
}
test();
