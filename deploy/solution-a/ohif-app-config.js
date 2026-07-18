window.config = {
  routerBasename: "/",
  showStudyList: true,
  dataSources: [{
    namespace: "@ohif/extension-default.dataSourcesModule.dicomweb",
    sourceName: "dicomweb",
    configuration: {
      friendlyName: "Solution A Orthanc",
      name: "ORTHANC",
      qidoRoot: "/dicom-web",
      wadoRoot: "/dicom-web",
      wadoUriRoot: "/wado",
      qidoSupportsIncludeField: true,
      imageRendering: "wadors",
      thumbnailRendering: "wadors"
    }
  }],
  defaultDataSourceName: "dicomweb"
};
