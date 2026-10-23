import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const API_BASE = "http://127.0.0.1:8000";
const state = { temperature: 32, humidity: 70, occupancy: null, mode: "Awaiting data", demand: null };
const $ = (id) => document.getElementById(id);

function updateClock() {
  $("clock").textContent = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(new Date());
}
setInterval(updateClock, 1000);
updateClock();

function addActivity(message, tone = "") {
  const item = document.createElement("div");
  item.className = "activity-item";
  item.innerHTML = `<i class="activity-dot ${tone}"></i><span>${message}<small>Just now</small></span>`;
  $("activity-list").prepend(item);
}

function setConnection(online) {
  const pill = $("connection-status");
  pill.className = `connection-pill ${online ? "is-online" : "is-offline"}`;
  pill.innerHTML = `<i></i><span>${online ? "Backend online" : "Backend offline"}</span>`;
}

function renderClimate() {
  $("temp-status").textContent = `${state.temperature}°C`;
  $("humidity-status").textContent = `${state.humidity}%`;
  $("climate-temp").textContent = `${state.temperature.toFixed(1)}°`;
  $("climate-humidity").textContent = `${state.humidity}%`;
  $("climate-occupancy").textContent = state.occupancy === null ? "--%" : `${state.occupancy.toFixed(1)}%`;
  $("occupancy-status").textContent = state.occupancy === null ? "--%" : `${state.occupancy.toFixed(1)}%`;
  $("suggested-mode").textContent = state.mode;
  $("ac-mode").textContent = state.mode === "Awaiting data" ? "—" : state.mode;
  $("cooling-demand").textContent = state.demand === null ? "Cooling demand —" : `Cooling demand ${state.demand}/100`;
}

async function getJson(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function refreshDashboard() {
  try {
    await getJson("/health");
    setConnection(true);
    addActivity("Connected to HEMS backend", "good");
    const result = await getJson("/recommendation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ temperature_c: state.temperature, humidity_pct: state.humidity, occupancy_pct: 90 }),
    });
    const fuzzy = result.component_outputs.find((item) => item.component === "fuzzy_logic_controller");
    const occupancy = result.component_outputs.find((item) => item.component === "occupancy_estimation");
    state.mode = fuzzy?.output?.suggested_mode || result.overall_recommendation.ac_mode;
    state.demand = fuzzy?.output?.cooling_demand ?? null;
    state.occupancy = occupancy?.output?.occupancy_percentage ?? null;
    renderClimate();
    addActivity(`Recommendation updated · ${state.mode}`, "good");
    $("last-updated").textContent = `Last sync ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch (error) {
    setConnection(false);
    addActivity("Backend connection unavailable", "bad");
    $("command-result").innerHTML = "<strong>Backend unavailable.</strong> Start FastAPI on port 8000 to enable live data.";
  }
}

async function parseCommand(event) {
  event.preventDefault();
  const command = $("command-input").value.trim();
  if (!command) return;
  $("command-result").textContent = "Parsing command…";
  try {
    const result = await getJson("/commands/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });
    $("command-result").innerHTML = `<strong>${result.intent}</strong> · ${result.message}<br /><span>Confidence ${(result.confidence * 100).toFixed(0)}% · ${result.needs_clarification ? "clarification needed" : "recommendation only"}</span>`;
    addActivity(`Command parsed · ${result.intent}`, result.needs_clarification ? "" : "good");
  } catch (error) {
    $("command-result").innerHTML = "<strong>Unable to parse.</strong> Check that the backend is running.";
    addActivity("Command request failed", "bad");
  }
}

function createHouseScene() {
  const container = $("scene-wrap");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe4ecef);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(8, 7, 9);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (error) {
    $("scene-loading").innerHTML = `<span class="fallback-house">⌂</span><strong>3D preview unavailable</strong><small>WebGL is disabled in this browser environment. The live HEMS controls remain available.</small>`;
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = .06;
  controls.minDistance = 6;
  controls.maxDistance = 15;
  controls.maxPolarAngle = Math.PI / 2.05;

  scene.add(new THREE.HemisphereLight(0xf7fbff, 0x758792, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(5, 10, 6);
  sun.castShadow = true;
  scene.add(sun);

  const house = new THREE.Group();
  scene.add(house);
  const mat = (color, roughness = .78) => new THREE.MeshStandardMaterial({ color, roughness });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(8, .18, 6), mat(0xd7c9b5));
  floor.position.y = -.1; floor.receiveShadow = true; floor.name = "Living Room";
  house.add(floor);
  const wallMat = mat(0xf5f2eb);
  const wall = (x, y, z, sx, sy, sz, name = "Room") => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wallMat);
    mesh.position.set(x, y, z); mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; house.add(mesh); return mesh;
  };
  wall(-4, 1.6, 0, .16, 3.4, 6, "Living Room");
  wall(0, 1.6, 2.92, 8, 3.4, .16, "Kitchen");
  wall(0, 1.6, -2.92, 8, 3.4, .16, "Living Room");
  wall(3.92, 1.6, 1.25, .16, 3.4, 3.35, "Kitchen");
  const roomLine = mat(0xa8b9bb);
  const divider = new THREE.Mesh(new THREE.BoxGeometry(.1, 2.5, 2.3), roomLine);
  divider.position.set(0, 1.25, .95); divider.name = "Kitchen"; house.add(divider);
  const cube = (name, color, pos, size) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat(color));
    mesh.position.set(...pos); mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; house.add(mesh); return mesh;
  };
  cube("Sofa", 0xb87458, [1.8, .55, -.95], [2.7, 1, .8]);
  cube("Kitchen Counter", 0x4c5556, [-2.05, .7, 1.8], [2.5, 1.35, .65]);
  cube("Refrigerator", 0x9db0b7, [3.05, 1.35, 1.55], [.7, 2.7, .75]);
  cube("Air Conditioner", 0xe8e9e5, [1.8, 2.7, 2.72], [1.4, .35, .25]);
  const table = cube("Dining Table", 0x9b7855, [1.1, .65, 1.35], [1.6, .18, 1.1]);
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2;
    cube("Dining Chair", 0x6c826c, [1.1 + Math.cos(angle) * 1.1, .4, 1.35 + Math.sin(angle) * .85], [.42, .65, .42]);
  }
  const fan = new THREE.Group(); fan.name = "Ceiling Fan";
  const stem = cube("Ceiling Fan", 0x65767b, [-1.5, 2.75, -.7], [.08, .7, .08]); fan.add(stem);
  for (let i = 0; i < 4; i++) {
    const blade = cube("Ceiling Fan", 0x8aa29a, [-1.5, 2.4, -.7], [1.25, .06, .16]); blade.rotation.y = i * Math.PI / 2; fan.add(blade);
  }
  house.add(fan);
  const rug = cube("Living Room", 0xc9d6c8, [1.4, .02, -.75], [3.7, .04, 2.2]); rug.rotation.y = -.1;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const selectable = house.children.filter((object) => object.name);
  function select(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(selectable, true)[0];
    if (!hit) return;
    const object = hit.object;
    $("selection-card").classList.remove("hidden");
    $("selection-title").textContent = object.name;
    $("selection-detail").textContent = object.name === "Air Conditioner" ? `Suggested mode: ${state.mode}. Cooling demand: ${state.demand ?? "awaiting"} (recommendation only).` : "Interactive scene object. Device telemetry is not available.";
  }
  renderer.domElement.addEventListener("click", select);
  $("close-selection").addEventListener("click", () => $("selection-card").classList.add("hidden"));
  function resize() {
    const width = container.clientWidth, height = container.clientHeight;
    camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false);
  }
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(container); resize();
  $("scene-loading").classList.add("is-hidden");
  function animate() {
    requestAnimationFrame(animate);
    fan.rotation.y += .018;
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
}

$("command-form").addEventListener("submit", parseCommand);
$("clear-activity").addEventListener("click", () => { $("activity-list").innerHTML = ""; });
document.querySelectorAll(".scene-button").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".scene-button").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  addActivity(`${button.querySelector("span").textContent} scene selected`);
}));
renderClimate();
refreshDashboard();
createHouseScene();
