

var bit_size = 0.25;
var number_of_bits_half = 2;
var number_of_bits_quater = 12;
var number_of_bits_eight = 2;
var square_unit_width_by_bit = 1;
var nb_rows = 3;



function generate_geometry( bit_size, number_of_bits_half, number_of_bits_quater , number_of_bits_eight, square_unit_width_by_bit, nb_rows){
	var nb_of_bits = number_of_bits_half+number_of_bits_quater+number_of_bits_eight;
	var ret = {};
	ret.outcut = calc_outcut_size(square_unit_width_by_bit,nb_of_bits,nb_rows);
	console.log(nb_of_bits);
	console.log(calc_center_of_bits(square_unit_width_by_bit,nb_of_bits,nb_rows));
	ret.holes = distribute_radius(calc_center_of_bits(square_unit_width_by_bit,nb_of_bits,nb_rows),number_of_bits_half,number_of_bits_quater,number_of_bits_eight);
	return ret;
}


function calc_outcut_size(square_unit_width,nb_bits,nb_rows){
	// determinate the width and height of the outcut.
	var nb_square_unit_in_a_row;
	
	if (nb_bits%nb_rows) //if the nb of bits is not a multiple of the nb of rows.
		nb_square_unit_in_a_row = Math.floor(nb_bits/nb_rows)+1;
	else
		nb_square_unit_in_a_row = nb_bits/nb_rows;
		
	var outcut_width = (nb_square_unit_in_a_row+1) * square_unit_width ; // we add a blank square for the margin
	var outcut_heigth = (nb_rows+1)* square_unit_width;
	
	return {width : outcut_width, height : outcut_heigth};
}

function calc_center_of_bits(square_unit_width,nb_bits,nb_rows){
	//define the coordinates of the hole to drill.

	var nb_square_unit_in_a_row;
	if (nb_bits%nb_rows) //if the nb of bits is not a multiple of the nb of rows.
		nb_square_unit_in_a_row = Math.floor(nb_bits/nb_rows)+1;
	else
		nb_square_unit_in_a_row = nb_bits/nb_rows;
		
	var hole_pos_table = [];
	
	var k=0;
	for(var j=0;j<nb_rows;j++) // for each row
	{
		for(var i=0;i<nb_square_unit_in_a_row && k<nb_bits;i++) // for nb bit per row
		{
		var p = {
				x : (i+1)*square_unit_width, // half a square unit of margin + centered on the square unit
				y : (j+1)*square_unit_width
				};
		hole_pos_table.push(p);
		k++;
		}
	}
	return hole_pos_table;	
}

function distribute_radius(hole_pos_table, number_of_bits_half, number_of_bits_quater, number_of_bits_eight){
	var i = 0;
	
	for(i;i<number_of_bits_half;i++)
	{
		hole_pos_table[i].radius = 0.5/2;
	}
	for(i;i<number_of_bits_half+number_of_bits_quater;i++)
	{
		hole_pos_table[i].radius = 0.25/2;
	}
	for(i;i<number_of_bits_half+number_of_bits_quater+number_of_bits_eight;i++)
	{
		hole_pos_table[i].radius = 0.125/2;
	}
	return hole_pos_table;
}





