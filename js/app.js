const { createApp } = Vue;
const { jsPDF } = window.jspdf;

createApp({
  data() {
    return {
      countries: [],
      search: '',
      regionFilter: '',
      regions: [],
      showModal: false,
      selected: {},
      currentPage: 1,
      pageSize: 50,
      sortKey: '',
      sortAsc: true,
      latestUpdateYear: ''
    };
  },
  computed: {
    filteredCountries() {
      const keyword = this.search.toLowerCase().trim();
      let result = this.countries.filter(item =>
        [item.country_en, item.country_cn, item.agency_en, item.agency_cn]
          .some(field => field && field.toLowerCase().includes(keyword))
      );
      if (this.regionFilter) result = result.filter(item => item.region === this.regionFilter);
      if (this.sortKey) {
        result = result.sort((a, b) => {
          const aValue = a[this.sortKey] || 0;
          const bValue = b[this.sortKey] || 0;
          return this.sortAsc ? (aValue > bValue ? 1 : -1) : (aValue < bValue ? 1 : -1);
        });
      }
      return result;
    },
    paginatedCountries() {
      const start = (this.currentPage - 1) * this.pageSize;
      return this.filteredCountries.slice(start, start + this.pageSize);
    },
    totalPages() {
      return Math.ceil(this.filteredCountries.length / this.pageSize) || 1;
    }
  },
  methods: {
    sortBy(key) {
      this.sortAsc = this.sortKey === key ? !this.sortAsc : true;
      this.sortKey = key;
    },
    selectCountry(item) {
      this.selected = item;
      this.showModal = true;
    },
    clearFilters() {
      this.search = '';
      this.regionFilter = '';
      this.currentPage = 1;
    },
    exportToExcel() {
      const data = this.paginatedCountries.map(item => ({
        国家中文: item.country_cn,
        Country: item.country_en,
        环保部门: item.agency_cn + ' (' + item.agency_en + ')',
        官网: item.has_official_website === '是' ? item.website : '暂无官网',
        PM2_5: item.pm25 ?? '暂无数据',
        年份: item.pm25_year ?? '暂无数据'
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '当前页数据');
      XLSX.writeFile(wb, 'environmental_agencies_page_' + this.currentPage + '.xlsx');
    },
    exportMapAsImage() {
      const chartDom = document.getElementById('world-map');
      const chart = echarts.getInstanceByDom(chartDom);
      const url = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' });
      const link = document.createElement('a');
      link.href = url;
      link.download = 'pm25_world_map.png';
      link.click();
    },
    exportMapAsPDF() {
      html2canvas(document.getElementById('world-map')).then(canvas => {
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF({ orientation: 'landscape' });
        const width = pdf.internal.pageSize.getWidth();
        const height = (canvas.height * width) / canvas.width;
        pdf.addImage(imgData, 'PNG', 0, 10, width, height);
        pdf.save('pm25_world_map.pdf');
      });
    },
    initMap() {
      const chart = echarts.init(document.getElementById('world-map'));
      const mapData = this.countries.map(item => ({
        name: item.country_en,
        value: item.pm25 ?? 0
      }));

      chart.setOption({
        tooltip: { trigger: 'item', formatter: '{b}<br/>PM2.5: {c} μg/m³' },
        visualMap: {
          min: 0,
          max: Math.max(...mapData.map(item => item.value)) || 100,
          text: ['高浓度', '低浓度'],
          realtime: true,
          calculable: true,
          orient: 'vertical',
          right: 20,
          top: 'middle',
          itemHeight: 150,
          itemWidth: 10,
          inRange: {
            color: ['#e0f3db', '#a8ddb5', '#43a2ca', '#0868ac', '#084081']
          }
        },
        series: [{
          type: 'map',
          roam: true,
          map: 'world',
          zoom: 1,
          label: {
            show: true,
            fontSize: 9,
            color: '#333',
            formatter: function (params) {
              const keyCountries = ['China', 'India', 'United States', 'Russia', 'Brazil', 'Indonesia', 'Pakistan', 'Nigeria', 'Bangladesh', 'Mexico'];
              return keyCountries.includes(params.name) ? params.name : '';
            }
          },
          itemStyle: {
            areaColor: '#e0e0e0',
            borderColor: '#666',
            borderWidth: 1
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 12,
              color: '#000'
            },
            itemStyle: {
              areaColor: '#66bb6a',
              shadowBlur: 30,
              shadowColor: 'rgba(0,0,0,0.5)',
              borderColor: '#004d00',
              borderWidth: 2
            }
          },
          data: mapData
        }]
      });

       chart.on('click', params => {
        const country = this.countries.find(c => c.country_en === params.name);
        if (country && country.has_official_website === '是' && country.website) {
          window.open(country.website, '_blank');
        } else if (country) {
          this.selectCountry(country);
        }
      });


      chart.on('georoam', () => {
        const zoom = chart.getOption().series[0].zoom || 1;
        const dynamicLabels = zoom > 2;
        chart.setOption({
          series: [{
            label: {
              show: true,
              fontSize: 9,
              color: '#333',
              formatter: function (p) {
                if (!dynamicLabels) {
                  return ['China', 'India', 'United States'].includes(p.name) ? p.name : '';
                }
                return p.name;
              }
            }
          }]
        });
      });

      window.addEventListener('resize', () => chart.resize());
    }
  },
  mounted() {
    Promise.all([
      axios.get('global_environmental_agencies_final_with_language.json'),
      axios.get('who_pm25_latest_with_year.json')
    ]).then(([agencyRes, pm25Res]) => {
      const pm25Map = Object.fromEntries(pm25Res.data.map(pm => [pm.country_en.toLowerCase(), pm]));
      this.countries = agencyRes.data.map(item => {
        const pm25Data = pm25Map[item.country_en.toLowerCase()];
        return {
          ...item,
          pm25: pm25Data?.pm25 ?? null,
          pm25_year: pm25Data?.year ?? null
        };
      });
      this.regions = [...new Set(this.countries.map(item => item.region))];
      if (pm25Res.data.length > 0) {
        this.latestUpdateYear = Math.max(...pm25Res.data.map(p => p.year || 0)) + '年';
      }
      this.$nextTick(() => this.initMap());
    });
  }
}).mount('#app');
