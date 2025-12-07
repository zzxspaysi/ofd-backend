const SERVER_URL = "https://ofd-backend-czgu.onrender.com";

const makers = [
  {id:"pofd",name:"Платформа ОФД",sub:"Широкий выбор тарифов",tariffs:[
    {id:"1d",title:"1 день",price:50,desc:"Доступ на 1 день"},
    {id:"1m",title:"1 месяц",price:450,desc:"Месячный тариф"},
    {id:"3m",title:"3 месяца",price:1200,desc:"Выгодно"},
    {id:"6m",title:"6 месяцев",price:2200,desc:"Полгода"},
    {id:"12m",title:"12 месяцев",price:4000,desc:"1 год"},
  ]},
  {id:"1ofd",name:"Первый ОФД",sub:"Оптимальные тарифы",tariffs:[
    {id:"12of",title:"12 месяцев",price:450,desc:""},
    {id:"36of",title:"36 месяцев",price:1000,desc:""},
  ]},
];

let cart = JSON.parse(localStorage.getItem("cart")||"{}");

function renderMakers() {
  const box = document.getElementById("makersContainer");
  box.innerHTML = "";
  makers.forEach(m=>{
    const el = document.createElement("div");
    el.className = "maker-card";
    el.innerHTML = `<div>${m.name}</div><div style="font-weight:400;color:rgba(255,255,255,0.6)">${m.sub}</div>`;
    el.onclick = ()=> showTariffs(m.id);
    box.appendChild(el);
  });
}

function showTariffs(id){
  const m = makers.find(x=>x.id==id);
  const box = document.getElementById("tariffsContainer");
  box.innerHTML = "";
  m.tariffs.forEach(t=>{
    const key = id+"::"+t.id;
    const card = document.createElement("div");
    card.className = "tariff-card";
    card.innerHTML = `<div style="font-weight:700">${t.title}</div>
      <div class="price">${t.price} ₽</div>
      <div style="color:rgba(255,255,255,0.6)">${t.desc}</div>
      <div class="qty-box">
        <button class="qty-btn" onclick="changeQty('${key}', -1)">−</button>
        <input id="q-${key}" value="1" style="width:42px;text-align:center;background:transparent;border:none;color:#e6eef9">
        <button class="qty-btn" onclick="changeQty('${key}', 1)">+</button>
      </div>
      <button class="add-btn" onclick="addToCart('${id}','${t.id}')">В корзину</button>`;
    box.appendChild(card);
  });
}

function changeQty(key,d){
  const e = document.getElementById("q-"+key);
  let v = parseInt(e.value)||1; v = Math.max(1, v+d); e.value = v;
}

function addToCart(mid,pid){
  const key = mid+"::"+pid;
  const e = document.getElementById("q-"+key);
  const qty = parseInt(e.value)||1;
  const m = makers.find(x=>x.id==mid);
  const t = m.tariffs.find(x=>x.id==pid);
  if(!cart[key]) cart[key] = { title: m.name + " — " + t.title, price: t.price, qty:0 };
  cart[key].qty += qty;
  saveCart();
  flash(e);
}

function saveCart(){ localStorage.setItem("cart", JSON.stringify(cart)); renderCart(); }

function renderCart(){
  const items = document.getElementById("cartItems");
  items.innerHTML = "";
  let total = 0, count = 0;
  Object.keys(cart).forEach(k=>{
    const it = cart[k];
    const div = document.createElement("div");
    div.className = "cart-item";
    div.innerHTML = `<div>${it.title}<div style="color:rgba(255,255,255,0.6)">${it.qty} × ${it.price} ₽</div></div>
      <div><button class="nav-btn" onclick="changeCartQty('${k}',1)">+</button>
      <button class="nav-btn" onclick="changeCartQty('${k}',-1)">−</button>
      <button class="nav-btn" onclick="removeItem('${k}')" style="background:rgba(255,80,80,0.12)">✕</button></div>`;
    items.appendChild(div);
    total += it.qty * it.price; count += it.qty;
  });
  document.getElementById("cartCount").innerText = count;
  document.getElementById("cartTotal").innerText = total + " ₽";
}

function changeCartQty(k,d){ if(!cart[k]) return; cart[k].qty = Math.max(0, cart[k].qty + d); if(cart[k].qty===0) delete cart[k]; saveCart(); }
function removeItem(k){ delete cart[k]; saveCart(); }

document.getElementById("cartBtn").onclick = ()=>{
  const m = document.getElementById("cartModal");
  m.style.display = (m.style.display==="flex")? "none":"flex";
  renderCart();
};
document.getElementById("closeCartBtn").onclick = ()=> document.getElementById("cartModal").style.display="none";
document.getElementById("clearCartBtn").onclick = ()=> { if(confirm("Очистить?")){ cart={}; saveCart(); } };
document.getElementById("checkoutBtn").onclick = async ()=>{
  const token = localStorage.getItem("token");
  if(!token){ alert("Войдите чтобы оформить заказ"); return; }
  if(!Object.keys(cart).length) return alert("Корзина пуста");
  const phone = prompt("Телефон для связи");
  if(!phone) return;
  const items = Object.keys(cart).map(k=>({ title: cart[k].title, qty: cart[k].qty, price: cart[k].price }));
  const total = items.reduce((s,i)=>s+i.qty*i.price,0);
  const res = await fetch(SERVER_URL + "/api/orders", { method:"POST", headers: { "Content-Type":"application/json", "Authorization":"Bearer "+token }, body: JSON.stringify({ phone, items, total }) });
  const j = await res.json();
  if(res.ok){ alert("Заказ оформлен №" + (j.number||j.id||"—")); cart={}; saveCart(); document.getElementById("cartModal").style.display="none"; } else alert(j.error||"Ошибка");
};

renderMakers();
renderCart();

function flash(el){ if(!el) return; el.style.boxShadow="0 0 0 6px rgba(38,24,177,0.08)"; setTimeout(()=>el.style.boxShadow="",250); }
