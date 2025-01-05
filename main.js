import { initializeApp } from "https://www.gstatic.com/firebasejs/9.20.0/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/9.20.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyBXvu6K3l3-ETz3kQeXBMdpD46-r-myd1g",
    authDomain: "store-bazaar-39fbf.firebaseapp.com",
    databaseURL: "https://store-bazaar-39fbf-default-rtdb.firebaseio.com",
    projectId: "store-bazaar-39fbf",
    storageBucket: "store-bazaar-39fbf.appspot.com",
    messagingSenderId: "507580360509",
    appId: "1:507580360509:web:1370c39ad6a84f6ea0c754",
    measurementId: "G-M78YMK2TMT",
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const dbRef = ref(database, "productdata");

const gridView = document.getElementById("gridView");
const popup = document.getElementById("popup");
const overlay = document.getElementById("overlay");
const popupImg = document.getElementById("popupImg");
const popupTitle = document.getElementById("popupTitle");
const popupDescription = document.getElementById("popupDescription");
const popupPrice = document.getElementById("popupPrice");
const popupButton = document.getElementById("popupButton");

overlay.addEventListener("click", () => {
    popup.style.display = "none";
    overlay.style.display = "none";
});

popupButton.addEventListener("click", () => {
    window.open("https://cyberkillert.github.io/store-bazzar?id=download", "_blank");
});

onValue(dbRef, (snapshot) => {
    const data = snapshot.val();
    gridView.innerHTML = "";

    for (const key in data) {
        const item = data[key];
        const agric = item.agric ? JSON.parse(item.agric)[0] : "https://via.placeholder.com/150";
        const title = item.pdhwjcgeg || "No Title";
        const description = item.pafetcbsck || "No Description";
        const price = item.pxsgyroeet || "0";

        const gridItem = document.createElement("div");
        gridItem.className = "grid-item";

        const shimmerDiv = document.createElement("div");
        shimmerDiv.className = "shimmer";

        const imgElement = document.createElement("img");
        imgElement.src = agric;
        imgElement.alt = "Image";

        imgElement.onload = () => {
            shimmerDiv.style.display = "none";
            imgElement.style.display = "block";
        };

        const titleElement = document.createElement("h3");
        titleElement.className = "small-title";
        titleElement.innerText = title;

        const priceElement = document.createElement("p");
        priceElement.className = "price-text";
        priceElement.innerText = ` ${price} `;

        const descriptionElement = document.createElement("p");
        descriptionElement.innerText = description;

        const titlePriceContainer = document.createElement("div");
        titlePriceContainer.className = "title-price";
        titlePriceContainer.appendChild(titleElement);
        titlePriceContainer.appendChild(priceElement);

        gridItem.appendChild(shimmerDiv);
        gridItem.appendChild(imgElement);
        gridItem.appendChild(titlePriceContainer);
        gridItem.appendChild(descriptionElement);

        gridItem.addEventListener("click", () => {
            popupImg.src = agric;
            popupTitle.innerText = title;
            popupDescription.innerText = description;
            popupPrice.innerText = `RS. ${price}`;
            popup.style.display = "block";
            overlay.style.display = "block";
        });

        gridView.appendChild(gridItem);
    }
});￼Enter
