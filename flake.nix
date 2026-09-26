{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  };

  outputs =
    { self, nixpkgs, ... }:
    let
      systems = [
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          website = pkgs.stdenvNoCC.mkDerivation {
            pname = "gabrielopesantos-website";
            version = "0.1.0";
            src = ./.;
            nativeBuildInputs = [
              pkgs.zola
              pkgs.terser
            ];
            buildPhase = ''
              terser static/flow-field.js --compress --mangle --output static/flow-field.js.min
              mv static/flow-field.js.min static/flow-field.js
              zola build
            '';
            installPhase = ''
              mkdir -p $out/share/website
              cp -rT public $out/share/website
            '';
          };
          default = self.packages.${system}.website;
        }
      );

      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = [ pkgs.zola ];
          };
        }
      );

      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt-rfc-style);
    };
}
