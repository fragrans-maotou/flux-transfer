import Vue from 'vue';
import App from './App.vue';
import { setVue } from 'flux-transfer/vue2';

// 注入 Vue 实例，使适配器可以使用 Vue.observable
setVue(Vue);
new Vue({
  render: (h) => h(App),
}).$mount('#app');
